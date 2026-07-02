import { databaseSession } from "../../../shared/database/database-client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { AuthorizationService } from "../../../shared/auth/authorization.service.js";
import { mapProcessingJob } from "../../../shared/utils/mappers.js";
import type { UploadMetadataRepository } from "../../upload/upload-metadata.repository.js";
import type { ProcessingJobRepository } from "./processing-job.repository.js";

export class AIExecutionService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
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
      jobType: "semantic_ingestion" | "manual_review" | "export" | "other";
      payload?: Record<string, unknown>;
    },
  ) {
    const { project } = await this.authorizationService.canEditProject(userId, projectId);

    if (input.activityId) {
      const activity = (await this.authorizationService.canEditActivity(userId, input.activityId))
        .activity;
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

  async update(
    userId: string,
    processingJobId: string,
    input: {
      status?: "queued" | "processing" | "completed" | "failed" | "cancelled";
      payload?: Record<string, unknown> | null;
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ) {
    const existingJob = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );
    if (!existingJob) {
      throw new AppError("Processing job not found.", 404, "processing_job_not_found");
    }

    await this.authorizationService.canEditProject(userId, existingJob.projectId);

    const updatedJob = await this.processingJobRepository.update(
      processingJobId,
      {
        status: input.status,
        payload: input.payload === undefined ? undefined : input.payload ?? null,
        errorMessage:
          input.errorMessage === undefined ? undefined : input.errorMessage?.trim() ?? null,
        startedAt:
          input.startedAt === undefined
            ? undefined
            : input.startedAt
              ? new Date(input.startedAt)
              : null,
        completedAt:
          input.completedAt === undefined
            ? undefined
            : input.completedAt
              ? new Date(input.completedAt)
              : null,
      },
      databaseSession,
    );

    return mapProcessingJob(updatedJob);
  }

  async getById(userId: string, processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError("Processing job not found.", 404, "processing_job_not_found");
    }

    await this.authorizationService.canViewProject(userId, job.projectId);

    return mapProcessingJob(job);
  }
}
