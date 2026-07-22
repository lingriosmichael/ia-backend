import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../../shared/database/databaseClient.js";
import { AppError } from "../../../shared/errors/appError.js";
import { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import { mapProcessingJob } from "../../../shared/utils/mappers.js";
import type {
  PrivacyReviewDecisions,
  ProcessingJobRecord,
  ProcessingJobType,
  ProcessingJobStatus,
} from "../../../shared/contracts.js";
import { InterpretationArtifactService } from "../../interpretation/interpretationArtifactService.js";
import type { ParsedRepresentationRepository } from "../../processing/parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "../../processing/privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "../../processing/privacySafeRepresentationRepository.js";
import { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import { FileStorageService } from "../../upload/fileStorageService.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { ProcessingJobPersistenceRecord } from "../persistence/aiPersistenceTypes.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";

const workerLeaseDurationMs = 90_000;
const terminalJobStatuses: ProcessingJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

interface ProcessorStatusPayload {
  externalJobId: string;
  status:
    | "accepted"
    | "processing"
    | "awaiting_privacy_review"
    | "transforming"
    | "completed"
    | "failed"
    | "cancelled";
  updatedAt: string;
  failureCode?: string | null;
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}

interface ActivityGoalsContext {
  objectives: string | null;
  successIndicators: string | null;
}

interface ProjectImpactModelContext {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
}

interface ProjectGoalsContext {
  projectGoal: string | null;
  impactModel: ProjectImpactModelContext | null;
  successIndicators: string | null;
}

type WorkerJobContext =
  | {
      kind: "evidence_processing_parse";
      uploadMetadataId: string;
      projectId: string;
      activityId: string | null;
      storageKey: string;
      originalFileName: string;
      contentType: string | null;
    }
  | {
      kind: "evidence_processing_transform";
      uploadMetadataId: string;
      parsedRepresentation: Record<string, unknown>;
      decisions: PrivacyReviewDecisions;
    }
  | {
      kind: "dataset_interpretation";
      privacySafeRepresentationId: string;
      payload: Record<string, unknown>;
      language: "de" | "en";
      activityGoals: ActivityGoalsContext | null;
      projectGoals: ProjectGoalsContext | null;
    };

interface ClaimedWorkerJobResponse {
  job: ProcessingJobRecord;
  context: WorkerJobContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readLanguageFromPayload(
  payload: Record<string, unknown> | null,
): "de" | "en" {
  return payload?.language === "en" ? "en" : "de";
}

function readActivityGoalsFromPayload(
  payload: Record<string, unknown> | null,
): ActivityGoalsContext | null {
  const activityGoals = payload?.activityGoals;
  if (!isRecord(activityGoals)) {
    return null;
  }

  return {
    objectives: readNullableString(activityGoals.objectives),
    successIndicators: readNullableString(activityGoals.successIndicators),
  };
}

function readProjectGoalsFromPayload(
  payload: Record<string, unknown> | null,
): ProjectGoalsContext | null {
  const projectGoals = payload?.projectGoals;
  if (!isRecord(projectGoals)) {
    return null;
  }

  const impactModel = isRecord(projectGoals.impactModel)
    ? {
        inputs: readNullableString(projectGoals.impactModel.inputs),
        activities: readNullableString(projectGoals.impactModel.activities),
        outputs: readNullableString(projectGoals.impactModel.outputs),
        outcomes: readNullableString(projectGoals.impactModel.outcomes),
        impact: readNullableString(projectGoals.impactModel.impact),
      }
    : null;

  return {
    projectGoal: readNullableString(projectGoals.projectGoal),
    impactModel,
    successIndicators: readNullableString(projectGoals.successIndicators),
  };
}

export class ProcessingJobService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly evidenceProcessingArtifactService: EvidenceProcessingArtifactService,
    private readonly interpretationArtifactService: InterpretationArtifactService,
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async listByActivity(userId: string, activityId: string) {
    await this.authorizationService.canViewActivity(userId, activityId);
    const jobs = await this.processingJobRepository.listByActivity(
      activityId,
      databaseSession,
    );
    return jobs.map(mapProcessingJob);
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      activityId?: string | null;
      uploadMetadataId?: string | null;
      jobType: ProcessingJobType;
      payload?: Record<string, unknown>;
    },
  ) {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    if (input.activityId) {
      const activity = (
        await this.authorizationService.canEditActivity(
          userId,
          input.activityId,
        )
      ).activity;
      if (activity.projectId !== project.id) {
        throw new AppError(
          "The activity does not belong to the specified project.",
          400,
          "activity_project_mismatch",
        );
      }
    }

    if (input.uploadMetadataId) {
      const uploadMetadata = await this.uploadMetadataRepository.findById(
        input.uploadMetadataId,
        databaseSession,
      );
      if (!uploadMetadata || uploadMetadata.projectId !== project.id) {
        throw new AppError(
          "Upload metadata does not belong to the specified project.",
          400,
          "upload_project_mismatch",
        );
      }
    }

    const job = await this.processingJobRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        activityId: input.activityId ?? null,
        uploadMetadataId: input.uploadMetadataId ?? null,
        triggeredById: userId,
        jobType: input.jobType,
        payload: input.payload ?? null,
      },
      databaseSession,
    );

    return mapProcessingJob(job);
  }

  async cancel(userId: string, processingJobId: string) {
    const existingJob = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );
    if (!existingJob) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    await this.authorizationService.canEditProject(
      userId,
      existingJob.projectId,
    );

    // Atomic conditional update: only a job that is still active can be
    // cancelled, closing the race between two concurrent cancel requests
    // (and preventing a cancel from resurrecting an already-terminal job).
    const cancelledJob = await this.processingJobRepository.cancelIfActive(
      processingJobId,
      new Date(),
      databaseSession,
    );

    if (!cancelledJob) {
      throw new AppError(
        "Processing job cannot be cancelled in its current state.",
        409,
        "processing_job_not_cancellable",
      );
    }

    return mapProcessingJob(cancelledJob);
  }

  async getById(userId: string, processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, job.projectId);

    return mapProcessingJob(job);
  }

  async sync(userId: string, processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, job.projectId);
    return mapProcessingJob(job);
  }

  async claimNextRunnableJob(
    workerId: string,
    supportedJobTypes: ProcessingJobType[],
  ): Promise<ClaimedWorkerJobResponse | null> {
    const now = new Date();
    const claimedJob = await this.processingJobRepository.claimNextRunnable(
      {
        workerId,
        supportedJobTypes,
        leaseExpiresAt: new Date(now.getTime() + workerLeaseDurationMs),
        now,
        claimedStatus: "processing",
      },
      databaseSession,
    );

    if (!claimedJob) {
      return null;
    }

    const context = await this.buildWorkerContext(claimedJob);
    return {
      job: mapProcessingJob(claimedJob),
      context,
    };
  }

  async renewLease(processingJobId: string, workerId: string) {
    const now = new Date();
    const renewedJob = await this.processingJobRepository.renewLease(
      {
        processingJobId,
        workerId,
        leaseExpiresAt: new Date(now.getTime() + workerLeaseDurationMs),
        heartbeatAt: now,
      },
      databaseSession,
    );

    if (!renewedJob) {
      throw new AppError(
        "Processing job lease could not be renewed.",
        409,
        "processing_job_lease_not_owned",
      );
    }

    return mapProcessingJob(renewedJob);
  }

  async getSourceFileForWorker(processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job?.uploadMetadataId) {
      throw new AppError(
        "Processing job source file is not available.",
        404,
        "processing_job_source_file_not_found",
      );
    }

    const uploadMetadata = await this.uploadMetadataRepository.findById(
      job.uploadMetadataId,
      databaseSession,
    );
    if (
      !uploadMetadata ||
      !uploadMetadata.storageKey ||
      uploadMetadata.originalFileDeletedAt
    ) {
      throw new AppError(
        "Processing job source file is not available.",
        404,
        "processing_job_source_file_not_found",
      );
    }

    const storedFile = await this.fileStorageService.openStoredFileStream(
      uploadMetadata.storageKey,
    );

    return {
      stream: storedFile.stream,
      contentType:
        uploadMetadata.contentType ??
        this.fileStorageService.getContentTypeForPath(
          uploadMetadata.storageKey,
        ),
      originalFileName: uploadMetadata.originalFileName,
    };
  }

  /**
   * Applies a job's terminal (or intermediate) status pushed directly by
   * Python, rather than pulled via sync(). No userId/authorization check —
   * this is only reachable through the internal-service-secret-guarded
   * route, not a user-facing one. Safe to call more than once for the same
   * job (e.g. a retried callback): a job that's already terminal is a
   * no-op.
   */
  async applyExternalCompletion(
    processingJobId: string,
    processorStatus: ProcessorStatusPayload,
  ) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    if (terminalJobStatuses.includes(job.status)) {
      return mapProcessingJob(job);
    }

    const updatedJob = await this.applyProcessorStatus(job, processorStatus);
    return mapProcessingJob(updatedJob);
  }

  private async buildWorkerContext(
    job: ProcessingJobPersistenceRecord,
  ): Promise<WorkerJobContext> {
    if (job.jobType === "evidence_processing") {
      const review = await this.privacyReviewRepository.findByProcessingJobId(
        job.id,
        databaseSession,
      );

      if (review?.status === "approved" && review.decisions) {
        if (!job.uploadMetadataId) {
          throw new AppError(
            "Processing job context is missing upload metadata.",
            500,
            "processing_job_context_incomplete",
          );
        }

        const parsedRepresentation =
          await this.parsedRepresentationRepository.findByProcessingJobId(
            job.id,
            databaseSession,
          );

        if (!parsedRepresentation) {
          throw new AppError(
            "Parsed representation is missing for privacy-safe transformation.",
            500,
            "processing_job_context_incomplete",
          );
        }

        return {
          kind: "evidence_processing_transform",
          uploadMetadataId: job.uploadMetadataId,
          parsedRepresentation: parsedRepresentation.payload,
          decisions: review.decisions,
        };
      }

      if (!job.uploadMetadataId) {
        throw new AppError(
          "Processing job context is missing upload metadata.",
          500,
          "processing_job_context_incomplete",
        );
      }

      const uploadMetadata = await this.uploadMetadataRepository.findById(
        job.uploadMetadataId,
        databaseSession,
      );
      if (!uploadMetadata || !uploadMetadata.storageKey) {
        throw new AppError(
          "Processing job source file is not available.",
          404,
          "processing_job_source_file_not_found",
        );
      }

      return {
        kind: "evidence_processing_parse",
        uploadMetadataId: uploadMetadata.id,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        storageKey: uploadMetadata.storageKey,
        originalFileName: uploadMetadata.originalFileName,
        contentType: uploadMetadata.contentType,
      };
    }

    const privacySafeRepresentationId =
      job.payload?.privacySafeRepresentationId;
    if (typeof privacySafeRepresentationId !== "string") {
      throw new AppError(
        "Privacy-safe representation reference is missing from the job payload.",
        500,
        "processing_job_context_incomplete",
      );
    }

    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findById(
        privacySafeRepresentationId,
        databaseSession,
      );
    if (!privacySafeRepresentation) {
      throw new AppError(
        "Privacy-safe representation not found for dataset interpretation.",
        404,
        "privacy_safe_representation_not_found",
      );
    }

    return {
      kind: "dataset_interpretation",
      privacySafeRepresentationId,
      payload: privacySafeRepresentation.payload,
      language: readLanguageFromPayload(job.payload),
      activityGoals: readActivityGoalsFromPayload(job.payload),
      projectGoals: readProjectGoalsFromPayload(job.payload),
    };
  }

  private async applyProcessorStatus(
    job: ProcessingJobPersistenceRecord,
    processorStatus: ProcessorStatusPayload,
  ): Promise<ProcessingJobPersistenceRecord> {
    const mappedStatus = this.mapProcessorStatus(processorStatus.status);

    if (job.jobType === "evidence_processing") {
      await this.evidenceProcessingArtifactService.ingestProcessorArtifacts(
        job,
        processorStatus.details,
        mappedStatus,
      );
    } else {
      await this.interpretationArtifactService.ingestProcessorArtifacts(
        job,
        processorStatus.details,
        mappedStatus,
      );
    }

    const updatedJob = await this.processingJobRepository.update(
      job.id,
      {
        status: mappedStatus,
        failureCode:
          processorStatus.failureCode === undefined
            ? undefined
            : (processorStatus.failureCode ?? null),
        errorMessage:
          processorStatus.errorMessage === undefined
            ? undefined
            : (processorStatus.errorMessage ?? null),
        leaseOwner:
          mappedStatus === "processing" || mappedStatus === "transforming"
            ? job.leaseOwner
            : null,
        leaseExpiresAt:
          mappedStatus === "processing" || mappedStatus === "transforming"
            ? job.leaseExpiresAt
            : null,
        lastHeartbeatAt:
          mappedStatus === "processing" || mappedStatus === "transforming"
            ? job.lastHeartbeatAt
            : null,
        completedAt: terminalJobStatuses.includes(mappedStatus)
          ? new Date(processorStatus.updatedAt)
          : mappedStatus === "awaiting_privacy_review"
            ? null
            : undefined,
        payload: {
          ...(job.payload ?? {}),
          pythonJob: {
            ...((job.payload?.pythonJob as
              Record<string, unknown> | undefined) ?? {}),
            externalJobId: processorStatus.externalJobId,
            status: processorStatus.status,
            updatedAt: processorStatus.updatedAt,
            details: processorStatus.details ?? null,
          },
          sync: {
            syncedAt: new Date().toISOString(),
          },
        },
      },
      databaseSession,
    );

    // Logged once per real transition (not per poll — the frontend polls
    // on a fixed interval regardless of whether anything changed), so this
    // is the line to grep for when checking whether a job is progressing.
    if (updatedJob.status !== job.status) {
      this.logger.info(
        {
          processingJobId: job.id,
          jobType: job.jobType,
          fromStatus: job.status,
          toStatus: updatedJob.status,
          errorMessage: updatedJob.errorMessage,
        },
        "processing job status changed",
      );
    }

    return updatedJob;
  }

  private mapProcessorStatus(
    status:
      | "accepted"
      | "processing"
      | "awaiting_privacy_review"
      | "transforming"
      | "completed"
      | "failed"
      | "cancelled",
  ): ProcessingJobStatus {
    if (status === "accepted") {
      return "queued";
    }

    return status;
  }
}
