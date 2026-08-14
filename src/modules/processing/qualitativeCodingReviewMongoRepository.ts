import type { QualitativeCodingReviewDecisions } from "../../shared/contracts.js";
import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  QualitativeCodingReviewMongoModel,
  type QualitativeCodingReviewMongoHydratedDocument,
} from "./qualitativeCodingReviewModel.js";
import type { QualitativeCodingReviewRepository } from "./qualitativeCodingReviewRepository.js";
import type {
  QualitativeCodingReviewApproveInput,
  QualitativeCodingReviewPersistenceRecord,
  QualitativeCodingReviewUpsertInput,
} from "./qualitativeCodingReviewPersistence.js";

function toQualitativeCodingReviewRecord(
  document: QualitativeCodingReviewMongoHydratedDocument | null,
): QualitativeCodingReviewPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId,
    privacySafeRepresentationId: document.privacySafeRepresentationId,
    interpretationResultId: document.interpretationResultId,
    status: document.status,
    findings: (document.findings ?? {}) as Record<string, unknown>,
    decisions: (document.decisions ??
      null) as QualitativeCodingReviewDecisions | null,
    approvedById: document.approvedById ?? null,
    approvedAt: document.approvedAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoQualitativeCodingReviewRepository implements QualitativeCodingReviewRepository {
  async upsertByUploadMetadataId(
    input: QualitativeCodingReviewUpsertInput,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord> {
    const document = await applyMongoSession(
      QualitativeCodingReviewMongoModel.findOneAndUpdate(
        { uploadMetadataId: input.uploadMetadataId },
        {
          $set: {
            privacySafeRepresentationId: input.privacySafeRepresentationId,
            interpretationResultId: input.interpretationResultId,
            findings: input.findings,
            status: "pending",
            decisions: null,
            approvedById: null,
            approvedAt: null,
          },
          $setOnInsert: {
            _id: createDocumentId(),
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            uploadMetadataId: input.uploadMetadataId,
          },
        },
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toQualitativeCodingReviewRecord(
      document,
    ) as QualitativeCodingReviewPersistenceRecord;
  }

  async findByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord | null> {
    const document = await applyMongoSession(
      QualitativeCodingReviewMongoModel.findOne({ uploadMetadataId }),
      session,
    ).exec();
    return toQualitativeCodingReviewRecord(document);
  }

  async approveIfPending(
    uploadMetadataId: string,
    input: QualitativeCodingReviewApproveInput,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord | null> {
    const document = await applyMongoSession(
      QualitativeCodingReviewMongoModel.findOneAndUpdate(
        { uploadMetadataId, status: "pending" },
        {
          $set: {
            status: "approved",
            decisions: input.decisions,
            approvedById: input.approvedById,
            approvedAt: input.approvedAt,
          },
        },
        { returnDocument: "after" },
      ),
      session,
    ).exec();
    return toQualitativeCodingReviewRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      QualitativeCodingReviewMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      QualitativeCodingReviewMongoModel.deleteMany({ activityId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      QualitativeCodingReviewMongoModel.deleteMany({ uploadMetadataId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
