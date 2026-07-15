import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  ParsedRepresentationMongoModel,
  type ParsedRepresentationMongoHydratedDocument,
} from "./parsedRepresentationModel.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type {
  ParsedRepresentationPersistenceRecord,
  ParsedRepresentationUpsertInput,
} from "./parsedRepresentationPersistence.js";

function toParsedRepresentationRecord(
  document: ParsedRepresentationMongoHydratedDocument | null,
): ParsedRepresentationPersistenceRecord | null {
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
    fileType: document.fileType,
    payload: (document.payload ?? {}) as Record<string, unknown>,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoParsedRepresentationRepository implements ParsedRepresentationRepository {
  async upsertByProcessingJobId(
    input: ParsedRepresentationUpsertInput,
    session: DatabaseSession,
  ): Promise<ParsedRepresentationPersistenceRecord> {
    const document = await applyMongoSession(
      ParsedRepresentationMongoModel.findOneAndUpdate(
        { processingJobId: input.processingJobId },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            uploadMetadataId: input.uploadMetadataId,
            processingJobId: input.processingJobId,
            fileType: input.fileType,
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

    return toParsedRepresentationRecord(
      document,
    ) as ParsedRepresentationPersistenceRecord;
  }

  async findByProcessingJobId(
    processingJobId: string,
    session: DatabaseSession,
  ): Promise<ParsedRepresentationPersistenceRecord | null> {
    const document = await applyMongoSession(
      ParsedRepresentationMongoModel.findOne({
        processingJobId,
      }),
      session,
    ).exec();
    return toParsedRepresentationRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ParsedRepresentationMongoModel.deleteMany({
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
      ParsedRepresentationMongoModel.deleteMany({
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
      ParsedRepresentationMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
