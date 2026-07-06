import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { mapUploadMetadata } from "../../shared/utils/mappers.js";
import { ActivityService } from "../activity/activityService.js";
import { FileStorageService } from "./fileStorageService.js";
import type { UploadMetadataRepository } from "./uploadMetadataRepository.js";

function mapUploadStatus(status: "pending" | "uploaded" | "archived") {
  return status;
}

export class UploadMetadataService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly activityService: ActivityService,
    private readonly authorizationService: AuthorizationService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async listByActivity(userId: string, activityId: string) {
    await this.activityService.getById(userId, activityId);
    const records = await this.uploadMetadataRepository.listByActivity(
      activityId,
      databaseSession,
    );

    return records.map(mapUploadMetadata);
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      activityId?: string | null;
      originalFileName: string;
      contentType?: string;
      sizeBytes?: number;
      storageKey?: string;
    },
  ) {
    const project = input.activityId
      ? (
          await this.authorizationService.canUploadToActivity(
            userId,
            input.activityId,
          )
        ).project
      : (await this.authorizationService.canEditProject(userId, projectId))
          .project;

    if (input.activityId) {
      const activity = await this.activityService.getById(
        userId,
        input.activityId,
      );
      if (activity.projectId !== project.id) {
        throw new AppError(
          "The activity does not belong to the specified project.",
          400,
          "activity_project_mismatch",
        );
      }
    }

    const record = await this.uploadMetadataRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        activityId: input.activityId ?? null,
        uploadedById: userId,
        originalFileName: input.originalFileName.trim(),
        contentType: input.contentType?.trim() ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey?.trim() ?? null,
      },
      databaseSession,
    );

    return mapUploadMetadata(record);
  }

  async update(
    userId: string,
    uploadMetadataId: string,
    input: {
      contentType?: string | null;
      sizeBytes?: number | null;
      storageKey?: string | null;
      status?: "pending" | "uploaded" | "archived";
    },
  ) {
    const existingRecord = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );
    if (!existingRecord) {
      throw new AppError(
        "Upload metadata not found.",
        404,
        "upload_metadata_not_found",
      );
    }

    await this.authorizationService.canEditProject(
      userId,
      existingRecord.projectId,
    );

    const updatedRecord = await this.uploadMetadataRepository.update(
      uploadMetadataId,
      {
        contentType:
          input.contentType === undefined
            ? undefined
            : (input.contentType?.trim() ?? null),
        sizeBytes: input.sizeBytes ?? undefined,
        storageKey:
          input.storageKey === undefined
            ? undefined
            : (input.storageKey?.trim() ?? null),
        status: input.status ? mapUploadStatus(input.status) : undefined,
      },
      databaseSession,
    );

    return mapUploadMetadata(updatedRecord);
  }

  async getFile(userId: string, uploadMetadataId: string) {
    const record = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!record || !record.storageKey) {
      throw new AppError(
        "Stored file could not be found.",
        404,
        "file_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, record.projectId);

    const storedFile = await this.fileStorageService.readStoredFile(
      record.storageKey,
    );

    return {
      buffer: storedFile.buffer,
      contentType:
        record.contentType ??
        this.fileStorageService.getContentTypeForPath(record.storageKey),
      originalFileName: record.originalFileName,
    };
  }
}
