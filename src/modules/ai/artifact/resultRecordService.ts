import { databaseSession } from "../../../shared/database/databaseClient.js";
import { AppError } from "../../../shared/errors/appError.js";
import { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import type { ResultRecordStatus } from "../../../shared/contracts.js";
import { mapResultRecord } from "../../../shared/utils/mappers.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { ProcessingJobRepository } from "../execution/processingJobRepository.js";
import type { ResultRepository } from "./resultRepository.js";

// A result record represents an artifact produced by a completed pipeline
// run. Once published it can only move forward (never back to "pending"),
// and "archived" is terminal — this prevents a project editor from
// resurrecting or silently rewriting a result after the fact.
const allowedResultRecordStatusTransitions: Record<
  ResultRecordStatus,
  ResultRecordStatus[]
> = {
  pending: ["available", "archived"],
  available: ["archived"],
  archived: [],
};

export class ResultRecordService {
  constructor(
    private readonly resultRepository: ResultRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listByActivity(userId: string, activityId: string) {
    await this.authorizationService.canViewActivity(userId, activityId);
    const results = await this.resultRepository.listByActivity(
      activityId,
      databaseSession,
    );
    return results.map(mapResultRecord);
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      activityId?: string | null;
      uploadMetadataId?: string | null;
      processingJobId?: string | null;
      resultType:
        "semantic_summary" | "activity_snapshot" | "project_snapshot" | "other";
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

    if (input.processingJobId) {
      const job = await this.processingJobRepository.findById(
        input.processingJobId,
        databaseSession,
      );
      if (!job || job.projectId !== project.id) {
        throw new AppError(
          "Processing job does not belong to the specified project.",
          400,
          "job_project_mismatch",
        );
      }

      if (job.status !== "completed") {
        throw new AppError(
          "A result can only be attached to a completed processing job.",
          409,
          "job_not_completed",
        );
      }
    }

    const result = await this.resultRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        activityId: input.activityId ?? null,
        uploadMetadataId: input.uploadMetadataId ?? null,
        processingJobId: input.processingJobId ?? null,
        createdById: userId,
        resultType: input.resultType,
        payload: input.payload ?? null,
      },
      databaseSession,
    );

    return mapResultRecord(result);
  }

  async update(
    userId: string,
    resultRecordId: string,
    input: {
      status?: "pending" | "available" | "archived";
      payload?: Record<string, unknown> | null;
    },
  ) {
    const existingResult = await this.resultRepository.findById(
      resultRecordId,
      databaseSession,
    );
    if (!existingResult) {
      throw new AppError(
        "Result record not found.",
        404,
        "result_record_not_found",
      );
    }

    await this.authorizationService.canEditProject(
      userId,
      existingResult.projectId,
    );

    if (existingResult.status === "archived") {
      throw new AppError(
        "An archived result record can no longer be modified.",
        409,
        "result_record_archived",
      );
    }

    if (
      input.status &&
      !allowedResultRecordStatusTransitions[existingResult.status].includes(
        input.status,
      )
    ) {
      throw new AppError(
        `A result record cannot move from "${existingResult.status}" to "${input.status}".`,
        409,
        "result_record_invalid_status_transition",
      );
    }

    const updatedResult = await this.resultRepository.update(
      resultRecordId,
      {
        status: input.status,
        payload:
          input.payload === undefined ? undefined : (input.payload ?? null),
      },
      databaseSession,
    );

    return mapResultRecord(updatedResult);
  }
}
