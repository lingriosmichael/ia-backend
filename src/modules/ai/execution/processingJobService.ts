import { databaseSession } from "../../../shared/database/databaseClient.js";
import { AppError } from "../../../shared/errors/appError.js";
import { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import { mapProcessingJob } from "../../../shared/utils/mappers.js";
import type {
  ProcessingJobType,
  ProcessingJobStatus,
} from "../../../shared/contracts.js";
import { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import { PythonProcessingClient } from "../../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";

export class ProcessingJobService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly evidenceProcessingArtifactService: EvidenceProcessingArtifactService,
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
      job.jobType !== "evidence_processing" ||
      ["completed", "failed", "cancelled"].includes(job.status)
    ) {
      return mapProcessingJob(job);
    }

    const externalJobId = this.getExternalJobId(job.payload);

    if (!externalJobId) {
      return mapProcessingJob(job);
    }

    const processorStatus =
      await this.pythonProcessingClient.getProcessingJobStatus(externalJobId);

    await this.evidenceProcessingArtifactService.ingestProcessorArtifacts(
      job,
      processorStatus.details,
      this.mapProcessorStatus(processorStatus.status),
    );

    const updatedJob = await this.processingJobRepository.update(
      processingJobId,
      {
        status: this.mapProcessorStatus(processorStatus.status),
        errorMessage:
          processorStatus.errorMessage === undefined
            ? undefined
            : (processorStatus.errorMessage ?? null),
        completedAt:
          processorStatus.status === "completed" ||
          processorStatus.status === "failed" ||
          processorStatus.status === "cancelled"
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

    return mapProcessingJob(updatedJob);
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
