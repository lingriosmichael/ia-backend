import type { PrivacyReviewDecisions } from "../../shared/contracts.js";
import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  PrivacyReviewMongoModel,
  type PrivacyReviewMongoHydratedDocument,
} from "./privacyReviewModel.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import type {
  PrivacyReviewApproveInput,
  PrivacyReviewPersistenceRecord,
  PrivacyReviewUpsertInput,
} from "./privacyReviewPersistence.js";

function toPrivacyReviewRecord(
  document: PrivacyReviewMongoHydratedDocument | null,
): PrivacyReviewPersistenceRecord | null {
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
    status: document.status,
    findings: (document.findings ?? {}) as Record<string, unknown>,
    decisions: (document.decisions ?? null) as PrivacyReviewDecisions | null,
    approvedById: document.approvedById ?? null,
    approvedAt: document.approvedAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoPrivacyReviewRepository implements PrivacyReviewRepository {
  async upsertByProcessingJobId(
    input: PrivacyReviewUpsertInput,
    _session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord> {
    const document = await PrivacyReviewMongoModel.findOneAndUpdate(
      { processingJobId: input.processingJobId },
      {
        // Only findings are updated on an existing review — status,
        // decisions, and approval fields must never be touched here, so a
        // retried parse can't silently reset an already-resolved review.
        $set: {
          findings: input.findings,
        },
        $setOnInsert: {
          _id: createDocumentId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          activityId: input.activityId,
          uploadMetadataId: input.uploadMetadataId,
          processingJobId: input.processingJobId,
          status: "pending",
        },
      },
      { upsert: true, returnDocument: "after" },
    ).exec();

    return toPrivacyReviewRecord(document) as PrivacyReviewPersistenceRecord;
  }

  async findByProcessingJobId(
    processingJobId: string,
    _session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord | null> {
    const document = await PrivacyReviewMongoModel.findOne({
      processingJobId,
    }).exec();
    return toPrivacyReviewRecord(document);
  }

  async approveIfPending(
    processingJobId: string,
    input: PrivacyReviewApproveInput,
    _session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord | null> {
    const document = await PrivacyReviewMongoModel.findOneAndUpdate(
      { processingJobId, status: "pending" },
      {
        $set: {
          status: "approved",
          decisions: input.decisions,
          approvedById: input.approvedById,
          approvedAt: input.approvedAt,
        },
      },
      { returnDocument: "after" },
    ).exec();

    return toPrivacyReviewRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacyReviewMongoModel.deleteMany({
      projectId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacyReviewMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await PrivacyReviewMongoModel.deleteMany({
      uploadMetadataId,
    }).exec();
    return result.deletedCount ?? 0;
  }
}
