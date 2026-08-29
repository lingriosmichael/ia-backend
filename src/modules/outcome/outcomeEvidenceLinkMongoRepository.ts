import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { isMongoDuplicateKeyError } from "../../shared/database/mongoErrors.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  OutcomeEvidenceLinkMongoModel,
  type OutcomeEvidenceLinkMongoHydratedDocument,
} from "./outcomeEvidenceLinkModel.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type {
  OutcomeEvidenceLinkMatchDiagnostics,
  OutcomeEvidenceLinkCreateInput,
  OutcomeEvidenceLinkPersistenceRecord,
} from "./outcomeEvidenceLinkPersistence.js";

// Every shape-specific field is nullable at the Mongoose schema level (see
// outcomeEvidenceLinkModel.ts) since which ones apply depends on `shape`,
// a distinction Mongoose itself doesn't enforce. Blindly casting each one
// `as string` would let a malformed partial write (e.g. a paired_delta
// document missing activityIdBefore) silently produce `undefined`
// masquerading as `string` instead of failing loudly. This throws instead.
function requireStringField(
  value: string | null | undefined,
  fieldName: string,
  documentId: string,
): string {
  if (value === null || value === undefined) {
    throw new Error(
      `OutcomeEvidenceLink document ${documentId} is missing required field '${fieldName}' for its declared shape.`,
    );
  }
  return value;
}

function toOutcomeEvidenceLinkRecord(
  document: OutcomeEvidenceLinkMongoHydratedDocument,
): OutcomeEvidenceLinkPersistenceRecord {
  const documentId = document._id.toString();
  const field = (value: string | null | undefined, fieldName: string) =>
    requireStringField(value, fieldName, documentId);
  const base = {
    linkId: documentId,
    organizationId: document.organizationId,
    projectId: document.projectId,
    outcomeId: document.outcomeId,
    confirmedById: document.confirmedById,
    confirmedAt: document.confirmedAt.toISOString(),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    matchDiagnostics:
      (document.matchDiagnostics as OutcomeEvidenceLinkMatchDiagnostics | null) ??
      null,
  };

  if (document.shape === "paired_delta") {
    return {
      ...base,
      shape: "paired_delta",
      activityIdBefore: field(document.activityIdBefore, "activityIdBefore"),
      activityIdAfter: field(document.activityIdAfter, "activityIdAfter"),
      beforeUploadMetadataId: field(
        document.beforeUploadMetadataId,
        "beforeUploadMetadataId",
      ),
      beforeTableName: field(document.beforeTableName, "beforeTableName"),
      beforeColumnName: field(document.beforeColumnName, "beforeColumnName"),
      afterUploadMetadataId: field(
        document.afterUploadMetadataId,
        "afterUploadMetadataId",
      ),
      afterTableName: field(document.afterTableName, "afterTableName"),
      afterColumnName: field(document.afterColumnName, "afterColumnName"),
      matchKey: field(document.matchKey, "matchKey"),
      pairingGroupKey: field(document.pairingGroupKey, "pairingGroupKey"),
    };
  }

  return {
    ...base,
    shape: "single_distribution",
    activityId: field(document.activityId, "activityId"),
    uploadMetadataId: field(document.uploadMetadataId, "uploadMetadataId"),
    tableName: field(document.tableName, "tableName"),
    categoryColumnName: field(
      document.categoryColumnName,
      "categoryColumnName",
    ),
  };
}

export class MongoOutcomeEvidenceLinkRepository implements OutcomeEvidenceLinkRepository {
  async deleteByOutcomeIds(
    outcomeIds: string[],
    session: DatabaseSession,
  ): Promise<number> {
    if (outcomeIds.length === 0) {
      return 0;
    }

    const result = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.deleteMany({
        outcomeId: { $in: outcomeIds },
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

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
    try {
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
    } catch (error) {
      // The unique { projectId, proposalId } index (outcomeEvidenceLinkModel.ts)
      // is the real duplicate-prevention guarantee: it closes the race that
      // an application-level read-then-write check (assertNotAlreadyConfirmed)
      // cannot, since two concurrent approve calls for the same recommendation
      // can both pass that check before either insert lands. This surfaces
      // the loser of that race as the same friendly error the read-check
      // already produces for the non-concurrent case.
      if (isMongoDuplicateKeyError(error)) {
        throw new AppError(
          "This evidence option has already been confirmed.",
          409,
          "outcome_evidence_link_already_confirmed",
        );
      }
      throw error;
    }
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

  async listByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord[]> {
    const documents = await applyMongoSession(
      OutcomeEvidenceLinkMongoModel.find({
        $or: [
          { activityId },
          { activityIdBefore: activityId },
          { activityIdAfter: activityId },
        ],
      }).sort({ createdAt: 1 }),
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
