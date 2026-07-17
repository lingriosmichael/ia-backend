import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../../shared/database/databaseClient.js";
import { AppError } from "../../../shared/errors/appError.js";
import { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import { mapProcessingJob } from "../../../shared/utils/mappers.js";
import type {
  ProcessingJobType,
  ProcessingJobStatus,
} from "../../../shared/contracts.js";
import { InterpretationArtifactService } from "../../interpretation/interpretationArtifactService.js";
import { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import { PythonProcessingClient } from "../../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { ProcessingJobPersistenceRecord } from "../persistence/aiPersistenceTypes.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";

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
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}

// Job types whose lifecycle is driven by an external Python job that this
// service polls and ingests artifacts from. Every other jobType is a no-op
// for sync() (e.g. it may be updated directly by its own service instead).
const syncableJobTypes: ProcessingJobType[] = [
  "evidence_processing",
  "dataset_interpretation",
];

export class ProcessingJobService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly evidenceProcessingArtifactService: EvidenceProcessingArtifactService,
    private readonly interpretationArtifactService: InterpretationArtifactService,
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

    if (
      !syncableJobTypes.includes(job.jobType) ||
      terminalJobStatuses.includes(job.status)
    ) {
      return mapProcessingJob(job);
    }

    const externalJobId = this.getExternalJobId(job.payload);

    if (!externalJobId) {
      return mapProcessingJob(job);
    }

    // Pulls the current status from Python. Interpretation jobs also push
    // their completion directly (see applyExternalCompletion) the instant
    // they finish, so by the time this poll fires the job is very often
    // already terminal in the database and this pull never happens at all
    // — this remains as a fallback for evidence-processing jobs (which
    // don't push) and as resilience if a push callback is ever missed.
    let processorStatus: ProcessorStatusPayload;
    try {
      processorStatus =
        await this.pythonProcessingClient.getProcessingJobStatus(externalJobId);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "python_processing_job_not_found"
      ) {
        const failedJob =
          await this.failJobBecauseExternalProcessorLostState(job);
        return mapProcessingJob(failedJob);
      }
      throw error;
    }
    const updatedJob = await this.applyProcessorStatus(job, processorStatus);

    return mapProcessingJob(updatedJob);
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
        errorMessage:
          processorStatus.errorMessage === undefined
            ? undefined
            : (processorStatus.errorMessage ?? null),
        completedAt: terminalJobStatuses.includes(mappedStatus)
          ? new Date(processorStatus.updatedAt)
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

  private async failJobBecauseExternalProcessorLostState(
    job: ProcessingJobPersistenceRecord,
  ): Promise<ProcessingJobPersistenceRecord> {
    const now = new Date();
    const updatedJob = await this.processingJobRepository.update(
      job.id,
      {
        status: "failed",
        errorMessage:
          "The external Python processing job is no longer available. Retry the upload to start a fresh processing run.",
        completedAt: now,
        payload: {
          ...(job.payload ?? {}),
          sync: {
            syncedAt: now.toISOString(),
            failureCode: "python_processing_job_not_found",
          },
        },
      },
      databaseSession,
    );

    this.logger.warn(
      {
        processingJobId: job.id,
        jobType: job.jobType,
        fromStatus: job.status,
        toStatus: updatedJob.status,
        pythonExternalJobId: this.getExternalJobId(job.payload),
      },
      "processing job failed because external Python job state was lost",
    );

    return updatedJob;
  }

  private getExternalJobId(payload: Record<string, unknown> | null) {
    const pythonJob = payload?.pythonJob;
    if (!pythonJob || typeof pythonJob !== "object") {
      return null;
    }

    const externalJobId = (pythonJob as Record<string, unknown>).externalJobId;
    return typeof externalJobId === "string" && externalJobId.length > 0
      ? externalJobId
      : null;
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
