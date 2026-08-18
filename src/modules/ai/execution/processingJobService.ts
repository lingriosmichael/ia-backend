import type { MultipartFile } from "@fastify/multipart";
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
import { UploadMetadataService } from "../../upload/uploadMetadataService.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { ProcessingJobPersistenceRecord } from "../persistence/aiPersistenceTypes.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";

const workerLeaseDurationMs = 90_000;
// How long a job can sit in "queued" with no worker ever having claimed it
// (leaseOwner still null) before sync() logs a warning. A healthy worker
// polls idle every 5s (see activityAnalysisWorker.ts / app/worker/main.py),
// so anything queued this long almost always means the worker process for
// that job type isn't running at all, not that it's merely busy — the
// symptom is otherwise silent: the job just sits there and the frontend
// polls forever with no error, no timeout, nothing in the logs pointing at
// the actual cause.
const queuedJobStalenessWarningMs = 60_000;
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
  activityType: string | null;
  objectives: string | null;
  output: string | null;
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
      kind: "workbook_split";
      uploadMetadataId: string;
      projectId: string;
      activityId: string | null;
      storageKey: string;
      originalFileName: string;
      contentType: string | null;
    }
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
    activityType: readNullableString(activityGoals.activityType),
    objectives: readNullableString(activityGoals.objectives),
    output: readNullableString(activityGoals.output),
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
    private readonly uploadMetadataService: UploadMetadataService,
    private readonly authorizationService: AuthorizationService,
    private readonly evidenceProcessingArtifactService: EvidenceProcessingArtifactService,
    private readonly interpretationArtifactService: InterpretationArtifactService,
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Warn at most once per job, not once per poll — sync() is polled at a
  // ~1s cadence by the frontend while a job is active, and a stale-queued
  // job can sit there for a long time before someone notices.
  private readonly staleQueuedJobIdsAlreadyWarned = new Set<string>();

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

    await this.authorizationService.canManageProject(
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
    this.warnIfStaleQueuedJob(job);
    return mapProcessingJob(job);
  }

  private warnIfStaleQueuedJob(job: ProcessingJobPersistenceRecord) {
    if (
      job.status !== "queued" ||
      job.leaseOwner ||
      this.staleQueuedJobIdsAlreadyWarned.has(job.id)
    ) {
      return;
    }

    const queuedForMs = Date.now() - job.createdAt.getTime();
    if (queuedForMs < queuedJobStalenessWarningMs) {
      return;
    }

    this.staleQueuedJobIdsAlreadyWarned.add(job.id);
    this.logger.warn(
      {
        processingJobId: job.id,
        jobType: job.jobType,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        queuedForMs,
      },
      "processing job has been queued for a long time with no worker ever claiming it — is the worker process for this jobType running? (activityAnalysisWorker.ts for activity_analysis_v2/qualitative_coding_review, app/worker/main.py for evidence_processing/dataset_interpretation/workbook_split)",
    );
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

  /**
   * Claim variant for job types executed in-process by a backend worker
   * (e.g. activityAnalysisWorker.ts), as opposed to claimNextRunnableJob's
   * Python-worker contract. Skips buildWorkerContext entirely: that method
   * exists only because Python has no direct DB access and needs the
   * backend to hand it everything over HTTP, whereas an in-process backend
   * worker already has direct access to the same repositories/services the
   * claimed job's own domain logic needs — it just needs the claimed job
   * record itself to read activityId/uploadMetadataId/payload from.
   */
  async claimNextRunnableBackendJob(
    workerId: string,
    supportedJobTypes: ProcessingJobType[],
  ): Promise<ProcessingJobRecord | null> {
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

    return claimedJob ? mapProcessingJob(claimedJob) : null;
  }

  /**
   * Completion variant for job types executed in-process by a backend
   * worker. Unlike applyExternalCompletion/applyProcessorStatus, there is
   * no artifact-ingestion step left to do here: the domain service the
   * worker calls (e.g. ActivityAnalysisV2Service.previewActivityAnalysis,
   * QualitativeCodingReviewService.generate) already persists its own
   * result record as a normal part of doing the work, before job
   * completion is ever recorded. This only flips the job's own
   * status/lease bookkeeping. Idempotent — a job that's already terminal is
   * a no-op, same guarantee applyExternalCompletion makes.
   */
  async completeBackendExecutedJob(
    processingJobId: string,
    workerId: string,
    outcome: {
      status: "completed" | "failed";
      errorMessage?: string | null;
    },
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

    const updatedJob = await this.processingJobRepository.update(
      job.id,
      {
        status: outcome.status,
        errorMessage: outcome.errorMessage ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        completedAt: new Date(),
      },
      databaseSession,
    );

    this.logger.info(
      {
        processingJobId: job.id,
        jobType: job.jobType,
        workerId,
        fromStatus: job.status,
        toStatus: updatedJob.status,
        errorMessage: updatedJob.errorMessage,
      },
      "backend-executed processing job status changed",
    );

    return mapProcessingJob(updatedJob);
  }

  async createDerivedWorkbookSheetUpload(
    processingJobId: string,
    file: MultipartFile | undefined,
    input: {
      sheetName: string;
      sheetIndex: number;
    },
  ) {
    if (!file) {
      throw new AppError("A file is required.", 400, "file_required");
    }

    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job || job.jobType !== "workbook_split" || !job.uploadMetadataId) {
      throw new AppError(
        "Workbook split job not found.",
        404,
        "workbook_split_job_not_found",
      );
    }

    if (!job.activityId) {
      throw new AppError(
        "Workbook split jobs require an activity-scoped source upload.",
        400,
        "workbook_split_activity_missing",
      );
    }

    if (terminalJobStatuses.includes(job.status)) {
      throw new AppError(
        "Workbook split job is no longer active.",
        409,
        "workbook_split_job_not_active",
      );
    }

    const storedFile = await this.fileStorageService.storeActivityUpload(
      job.activityId,
      file,
    );

    try {
      const refreshedJob = await this.processingJobRepository.findById(
        processingJobId,
        databaseSession,
      );

      if (
        !refreshedJob ||
        refreshedJob.jobType !== "workbook_split" ||
        terminalJobStatuses.includes(refreshedJob.status)
      ) {
        await this.deleteStoredFileQuietly(storedFile.storageKey);
        throw new AppError(
          "Workbook split job is no longer active.",
          409,
          "workbook_split_job_not_active",
        );
      }

      const result =
        await this.uploadMetadataService.createDerivedWorkbookSheetUpload({
          sourceWorkbookUploadMetadataId: job.uploadMetadataId,
          triggeredById: job.triggeredById,
          originalFileName: storedFile.originalFileName,
          contentType: storedFile.contentType,
          sizeBytes: storedFile.sizeBytes,
          storageKey: storedFile.storageKey,
          derivedSheetName: input.sheetName,
          derivedSheetIndex: input.sheetIndex,
        });

      if (!result.created) {
        await this.deleteStoredFileQuietly(storedFile.storageKey);
      }

      return result;
    } catch (error) {
      await this.deleteStoredFileQuietly(storedFile.storageKey);
      throw error;
    }
  }

  async rollbackDerivedWorkbookSheetUploads(processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job || job.jobType !== "workbook_split" || !job.uploadMetadataId) {
      throw new AppError(
        "Workbook split job not found.",
        404,
        "workbook_split_job_not_found",
      );
    }

    return this.uploadMetadataService.cleanupDerivedWorkbookSheetUploads(
      job.uploadMetadataId,
    );
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
    if (job.jobType === "workbook_split") {
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
        kind: "workbook_split",
        uploadMetadataId: uploadMetadata.id,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        storageKey: uploadMetadata.storageKey,
        originalFileName: uploadMetadata.originalFileName,
        contentType: uploadMetadata.contentType,
      };
    }

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

    if (job.jobType === "workbook_split") {
      if (mappedStatus === "completed" && job.uploadMetadataId) {
        await this.uploadMetadataService.archiveAfterWorkbookSplit(
          job.uploadMetadataId,
        );
      }
    } else if (job.jobType === "evidence_processing") {
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

  private async deleteStoredFileQuietly(storageKey: string) {
    try {
      await this.fileStorageService.deleteStoredFiles([storageKey]);
    } catch (error) {
      this.logger.warn(
        { storageKey, error },
        "Failed to delete duplicate derived workbook sheet upload.",
      );
    }
  }
}
