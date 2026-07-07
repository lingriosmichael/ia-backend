import { databaseSession } from "../../shared/database/databaseClient.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { mapUploadMetadata } from "../../shared/utils/mappers.js";
import { ActivityService } from "../activity/activityService.js";
import { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { ResultRepository } from "../ai/artifact/resultRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import { FileStorageService } from "./fileStorageService.js";
import type { UploadMetadataPersistenceRecord } from "./uploadMetadataPersistence.js";
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
    private readonly userRepository: UserRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly resultRepository: ResultRepository,
    private readonly processingResourceCleanupService: ProcessingResourceCleanupService,
  ) {}

  async listByActivity(userId: string, activityId: string) {
    await this.activityService.getById(userId, activityId);
    const records = await this.uploadMetadataRepository.listByActivity(
      activityId,
      databaseSession,
    );

    return this.mapRecordsWithUploaderNames(records);
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
      replacesUploadMetadataId?: string | null;
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

    let logicalEvidenceId: string | null = null;
    let versionNumber: number | null = null;
    let activityId = input.activityId ?? null;
    let replacedRecord: UploadMetadataPersistenceRecord | null = null;

    if (input.replacesUploadMetadataId) {
      replacedRecord = await this.uploadMetadataRepository.findById(
        input.replacesUploadMetadataId,
        databaseSession,
      );

      if (!replacedRecord || replacedRecord.projectId !== project.id) {
        throw new AppError(
          "The evidence version to replace does not belong to this project.",
          400,
          "replacement_evidence_not_found",
        );
      }

      if (replacedRecord.supersededAt) {
        throw new AppError(
          "Only the current evidence version can be replaced.",
          409,
          "replacement_evidence_already_superseded",
        );
      }

      const activeProcessingJob =
        await this.processingJobRepository.findActiveByUploadMetadataId(
          replacedRecord.id,
          databaseSession,
        );

      if (activeProcessingJob) {
        throw new AppError(
          "Evidence cannot be replaced while processing is still active.",
          409,
          "replacement_evidence_processing_in_progress",
        );
      }

      if (
        activityId !== null &&
        replacedRecord.activityId !== null &&
        activityId !== replacedRecord.activityId
      ) {
        throw new AppError(
          "Evidence versions must stay attached to the same activity.",
          400,
          "replacement_activity_mismatch",
        );
      }

      logicalEvidenceId = replacedRecord.logicalEvidenceId;
      versionNumber = replacedRecord.versionNumber + 1;
      activityId = activityId ?? replacedRecord.activityId;
    }

    const record = await this.uploadMetadataRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        activityId,
        uploadedById: userId,
        logicalEvidenceId,
        versionNumber,
        replacesUploadMetadataId: input.replacesUploadMetadataId ?? null,
        originalFileName: input.originalFileName.trim(),
        contentType: input.contentType?.trim() ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey?.trim() ?? null,
      },
      databaseSession,
    );

    if (replacedRecord) {
      await this.uploadMetadataRepository.update(
        replacedRecord.id,
        {
          supersededAt: new Date(),
          status: "archived",
        },
        databaseSession,
      );
    }

    return this.mapRecordWithUploaderName(record);
  }

  async update(
    userId: string,
    uploadMetadataId: string,
    input: {
      contentType?: string | null;
      sizeBytes?: number | null;
      storageKey?: string | null;
      supersededAt?: string | null;
      originalFileDeletedAt?: string | null;
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
        supersededAt:
          input.supersededAt === undefined
            ? undefined
            : input.supersededAt
              ? new Date(input.supersededAt)
              : null,
        originalFileDeletedAt:
          input.originalFileDeletedAt === undefined
            ? undefined
            : input.originalFileDeletedAt
              ? new Date(input.originalFileDeletedAt)
              : null,
        status: input.status ? mapUploadStatus(input.status) : undefined,
      },
      databaseSession,
    );

    return this.mapRecordWithUploaderName(updatedRecord);
  }

  async getFile(userId: string, uploadMetadataId: string) {
    const record = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!record || !record.storageKey || record.originalFileDeletedAt) {
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

  async delete(userId: string, uploadMetadataId: string) {
    const record = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!record) {
      throw new AppError(
        "Evidence record not found.",
        404,
        "evidence_not_found",
      );
    }

    await this.authorizationService.canEditProject(userId, record.projectId);

    const activeProcessingJob =
      await this.processingJobRepository.findActiveByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (activeProcessingJob) {
      throw new AppError(
        "Evidence cannot be deleted while processing is still active.",
        409,
        "evidence_processing_in_progress",
      );
    }

    await this.resultRepository.deleteByUploadMetadataId(
      uploadMetadataId,
      databaseSession,
    );
    await this.processingResourceCleanupService.deleteByUploadMetadataId(
      uploadMetadataId,
      databaseSession,
    );
    await this.processingJobRepository.deleteByUploadMetadataId(
      uploadMetadataId,
      databaseSession,
    );
    await this.uploadMetadataRepository.deleteById(
      uploadMetadataId,
      databaseSession,
    );

    if (record.storageKey && !record.originalFileDeletedAt) {
      await this.fileStorageService.deleteStoredFiles([record.storageKey]);
    }

    return {
      id: record.id,
      activityId: record.activityId,
      projectId: record.projectId,
    };
  }

  private async mapRecordsWithUploaderNames(
    records: UploadMetadataPersistenceRecord[],
  ) {
    const users = await this.userRepository.findByIds(
      [...new Set(records.map((record) => record.uploadedById))],
      databaseSession,
    );
    const uploaderNamesById = new Map(
      users.map((user) => [user.id, user.fullName] as const),
    );

    return records.map((record) =>
      mapUploadMetadata({
        ...record,
        uploadedByName: uploaderNamesById.get(record.uploadedById) ?? null,
      }),
    );
  }

  async deleteOriginalFileAfterPrivacySafePersistence(
    uploadMetadataId: string,
  ) {
    const record = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!record) {
      throw new AppError(
        "Upload metadata not found.",
        404,
        "upload_metadata_not_found",
      );
    }

    if (!record.storageKey || record.originalFileDeletedAt) {
      return this.mapRecordWithUploaderName(record);
    }

    await this.fileStorageService.deleteStoredFiles([record.storageKey]);

    const updatedRecord = await this.uploadMetadataRepository.update(
      uploadMetadataId,
      {
        originalFileDeletedAt: new Date(),
      },
      databaseSession,
    );

    return this.mapRecordWithUploaderName(updatedRecord);
  }

  private async mapRecordWithUploaderName(
    record: UploadMetadataPersistenceRecord,
  ) {
    const uploader = await this.userRepository.findById(
      record.uploadedById,
      databaseSession,
    );

    return mapUploadMetadata({
      ...record,
      uploadedByName: uploader?.fullName ?? null,
    });
  }
}
