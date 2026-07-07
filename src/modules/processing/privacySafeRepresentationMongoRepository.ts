import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  PrivacySafeRepresentationMongoModel,
  type PrivacySafeRepresentationMongoHydratedDocument,
} from "./privacySafeRepresentationModel.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";
import type {
  PrivacySafeRepresentationPersistenceRecord,
  PrivacySafeRepresentationUpsertInput,
} from "./privacySafeRepresentationPersistence.js";

function toPrivacySafeRepresentationRecord(
  document: PrivacySafeRepresentationMongoHydratedDocument | null,
): PrivacySafeRepresentationPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId,
    processingJobId: document.processingJobId,
    privacyReviewId: document.privacyReviewId,
    parsedRepresentationId: document.parsedRepresentationId,
    payload: (document.payload ?? {}) as Record<string, unknown>,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoPrivacySafeRepresentationRepository implements PrivacySafeRepresentationRepository {
  async upsertByProcessingJobId(
    input: PrivacySafeRepresentationUpsertInput,
    _session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord> {
    const document = await PrivacySafeRepresentationMongoModel.findOneAndUpdate(
      { processingJobId: input.processingJobId },
      {
        $set: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          uploadMetadataId: input.uploadMetadataId,
          processingJobId: input.processingJobId,
          privacyReviewId: input.privacyReviewId,
          parsedRepresentationId: input.parsedRepresentationId,
          payload: input.payload,
        },
        $setOnInsert: {
          _id: createDocumentId(),
        },
      },
      { upsert: true, new: true },
    ).exec();

    return toPrivacySafeRepresentationRecord(
      document,
    ) as PrivacySafeRepresentationPersistenceRecord;
  }

  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacySafeRepresentationMongoModel.deleteMany({
      projectId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacySafeRepresentationMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacySafeRepresentationMongoModel.deleteMany({
      uploadMetadataId,
    }).exec();
    return result.deletedCount ?? 0;
  }
}
