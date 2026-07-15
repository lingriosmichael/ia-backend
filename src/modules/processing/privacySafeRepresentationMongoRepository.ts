import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
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
    session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord> {
    const document = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.findOneAndUpdate(
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
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toPrivacySafeRepresentationRecord(
      document,
    ) as PrivacySafeRepresentationPersistenceRecord;
  }

  async findLatestByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord | null> {
    const document = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.findOne({
        uploadMetadataId,
      }).sort({ createdAt: -1 }),
      session,
    ).exec();

    return toPrivacySafeRepresentationRecord(document);
  }

  async findById(
    privacySafeRepresentationId: string,
    session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord | null> {
    const document = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.findById(privacySafeRepresentationId),
      session,
    ).exec();

    return toPrivacySafeRepresentationRecord(document);
  }

  async findLatestByUploadMetadataIds(
    uploadMetadataIds: string[],
    session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord[]> {
    if (uploadMetadataIds.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.find({
        uploadMetadataId: { $in: uploadMetadataIds },
      }).sort({ createdAt: -1 }),
      session,
    ).exec();

    const latestByUploadMetadataId = new Map<
      string,
      PrivacySafeRepresentationMongoHydratedDocument
    >();
    for (const document of documents) {
      if (!latestByUploadMetadataId.has(document.uploadMetadataId)) {
        latestByUploadMetadataId.set(document.uploadMetadataId, document);
      }
    }

    return Array.from(latestByUploadMetadataId.values())
      .map((document) => toPrivacySafeRepresentationRecord(document))
      .filter(
        (record): record is PrivacySafeRepresentationPersistenceRecord =>
          record !== null,
      );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.deleteMany({
        activityId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      PrivacySafeRepresentationMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
