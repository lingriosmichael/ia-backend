import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import { ProjectDerivedStateInvalidationService } from "../analytics/projectDerivedStateInvalidationService.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import { mapUploadMetadata } from "../../shared/utils/mappers.js";
import { ActivityService } from "../activity/activityService.js";
import { clearActivityAiKnowledgeStateIfPresent } from "../interpretation/interpretationReviewState.js";
import { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
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
    private readonly transactionManager: TransactionManager,
    private readonly activityRepository: ActivityRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly processingResourceCleanupService: ProcessingResourceCleanupService,
    private readonly projectDerivedStateInvalidationService: ProjectDerivedStateInvalidationService,
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
    let activityWithAuthorizationContext:
      | Awaited<
          ReturnType<AuthorizationService["canUploadToActivity"]>
        >["activity"]
      | null = null;
    let authorizedProject: Awaited<
      ReturnType<AuthorizationService["canEditProject"]>
    >["project"];

    if (input.activityId) {
      const context = await this.authorizationService.canUploadToActivity(
        userId,
        input.activityId,
      );
      authorizedProject = context.project;
      activityWithAuthorizationContext = context.activity;
    } else {
      authorizedProject = (
        await this.authorizationService.canEditProject(userId, projectId)
      ).project;
    }

    if (input.activityId) {
      const activity = await this.activityService.getById(
        userId,
        input.activityId,
      );
      if (activity.projectId !== authorizedProject.id) {
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

      if (
        !replacedRecord ||
        replacedRecord.projectId !== authorizedProject.id
      ) {
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
        organizationId: authorizedProject.organizationId,
        projectId: authorizedProject.id,
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

    if (activityId && activityWithAuthorizationContext) {
      const clearedActivityState = await clearActivityAiKnowledgeStateIfPresent(
        this.activityRepository,
        activityId,
        databaseSession,
      );

      if (clearedActivityState.clearedAcknowledgment) {
        await this.projectDerivedStateInvalidationService.invalidateProject(
          authorizedProject.id,
          databaseSession,
        );
      }
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

    await this.transactionManager.runInTransaction(async (session) => {
      if (record.activityId) {
        const activity = await this.activityRepository.findById(
          record.activityId,
          session,
        );

        if (activity) {
          const clearedActivityState =
            await clearActivityAiKnowledgeStateIfPresent(
              this.activityRepository,
              record.activityId,
              session,
            );

          if (clearedActivityState.clearedAcknowledgment) {
            await this.projectDerivedStateInvalidationService.invalidateProject(
              record.projectId,
              session,
            );
          }
        }
      }

      await this.processingResourceCleanupService.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      );
      await this.processingJobRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      );
      await this.uploadMetadataRepository.deleteById(uploadMetadataId, session);
    });

    if (record.storageKey && !record.originalFileDeletedAt) {
      // Filesystem deletion cannot participate in the database transaction.
      // By this point every database record referencing this file is
      // already gone, so a failure here can only leave unreferenced bytes
      // on disk — not a dangling reference reachable through the API —
      // which is why this step stays best-effort rather than failing the
      // now-already-completed delete.
      try {
        await this.fileStorageService.deleteStoredFiles([record.storageKey]);
      } catch (error) {
        console.error("Failed to delete stored upload file.", {
          uploadMetadataId,
          storageKey: record.storageKey,
          error,
        });
      }
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
