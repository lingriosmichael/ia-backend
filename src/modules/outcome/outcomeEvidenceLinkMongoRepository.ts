import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  OutcomeEvidenceLinkMongoModel,
  type OutcomeEvidenceLinkMongoHydratedDocument,
} from "./outcomeEvidenceLinkModel.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type {
  OutcomeEvidenceLinkCreateInput,
  OutcomeEvidenceLinkPersistenceRecord,
} from "./outcomeEvidenceLinkPersistence.js";

function toOutcomeEvidenceLinkRecord(
  document: OutcomeEvidenceLinkMongoHydratedDocument,
): OutcomeEvidenceLinkPersistenceRecord {
  const base = {
    linkId: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    outcomeId: document.outcomeId,
    confirmedById: document.confirmedById,
    confirmedAt: document.confirmedAt.toISOString(),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };

  if (document.shape === "paired_delta") {
    return {
      ...base,
      shape: "paired_delta",
      activityIdBefore: document.activityIdBefore as string,
      activityIdAfter: document.activityIdAfter as string,
      beforeUploadMetadataId: document.beforeUploadMetadataId as string,
      beforeTableName: document.beforeTableName as string,
      beforeColumnName: document.beforeColumnName as string,
      afterUploadMetadataId: document.afterUploadMetadataId as string,
      afterTableName: document.afterTableName as string,
      afterColumnName: document.afterColumnName as string,
      matchKey: document.matchKey as string,
      pairingGroupKey: document.pairingGroupKey as string,
    };
  }

  return {
    ...base,
    shape: "single_distribution",
    activityId: document.activityId as string,
    uploadMetadataId: document.uploadMetadataId as string,
    tableName: document.tableName as string,
    categoryColumnName: document.categoryColumnName as string,
  };
}

export class MongoOutcomeEvidenceLinkRepository implements OutcomeEvidenceLinkRepository {
  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.deleteMany({
        $or: [
          { activityId },
          { activityIdBefore: activityId },
          { activityIdAfter: activityId },
        ],
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
      OutcomeEvidenceLinkMongoModel.deleteMany({
        $or: [
          { uploadMetadataId },
          { beforeUploadMetadataId: uploadMetadataId },
          { afterUploadMetadataId: uploadMetadataId },
        ],
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async create(
    input: OutcomeEvidenceLinkCreateInput,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord> {
    const [document] = await OutcomeEvidenceLinkMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toOutcomeEvidenceLinkRecord(document);
  }

  async findById(
    linkId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord | null> {
    const document = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.findById(linkId),
      session,
    ).exec();

    return document ? toOutcomeEvidenceLinkRecord(document) : null;
  }

  async listByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord[]> {
    const documents = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.find({ projectId }).sort({
        createdAt: 1,
      }),
      session,
    ).exec();

    return documents.map((document) => toOutcomeEvidenceLinkRecord(document));
  }

  async deleteById(linkId: string, session: DatabaseSession): Promise<boolean> {
    const document = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.findByIdAndDelete(linkId),
      session,
    ).exec();

    return document !== null;
  }
}
