import type { StartEvidenceAnalysisResponse } from "../../shared/contracts.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { mapProcessingJob } from "../../shared/utils/mappers.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import { PythonProcessingClient } from "./pythonProcessingClient.js";

export class EvidenceProcessingService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
  ) {}

  async startEvidenceAnalysis(
    userId: string,
    uploadMetadataId: string,
  ): Promise<StartEvidenceAnalysisResponse> {
    const uploadMetadata = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!uploadMetadata) {
      throw new AppError("Evidence record not found.", 404, "evidence_not_found");
    }

    await this.authorizationService.canEditProject(
      userId,
      uploadMetadata.projectId,
    );

    if (uploadMetadata.status !== "uploaded") {
      throw new AppError(
        "Only uploaded evidence can be analysed.",
        409,
        "evidence_not_uploaded",
      );
    }

    if (!uploadMetadata.storageKey || uploadMetadata.originalFileDeletedAt) {
      throw new AppError(
        "The original uploaded file is no longer available for processing.",
        409,
        "original_file_not_available",
      );
    }

    const activeJob =
      await this.processingJobRepository.findActiveByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (activeJob) {
      throw new AppError(
        "A processing job is already active for this evidence version.",
        409,
        "processing_job_already_active",
      );
    }

    const queuedJob = await this.processingJobRepository.create(
      {
        organizationId: uploadMetadata.organizationId,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        uploadMetadataId: uploadMetadata.id,
        triggeredById: userId,
        jobType: "evidence_processing",
        payload: {
          source: "phase_2_evidence_processing",
        },
      },
      databaseSession,
    );

    try {
      const pythonJob = await this.pythonProcessingClient.startEvidenceProcessing({
        processingJobId: queuedJob.id,
        uploadMetadataId: uploadMetadata.id,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        storageKey: uploadMetadata.storageKey,
        originalFileName: uploadMetadata.originalFileName,
        contentType: uploadMetadata.contentType,
      });

      const startedJob = await this.processingJobRepository.update(
        queuedJob.id,
        {
          status: "processing",
          startedAt: new Date(),
          payload: {
            ...(queuedJob.payload ?? {}),
            pythonJob,
          },
        },
        databaseSession,
      );

      return {
        job: mapProcessingJob(startedJob),
      };
    } catch (error) {
      const failedJob = await this.processingJobRepository.update(
        queuedJob.id,
        {
          status: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Evidence processing could not be started.",
          completedAt: new Date(),
        },
        databaseSession,
      );

      return {
        job: mapProcessingJob(failedJob),
      };
    }
  }
}
