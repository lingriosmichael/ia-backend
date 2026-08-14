import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  QualitativeCodingReviewApproveInput,
  QualitativeCodingReviewPersistenceRecord,
  QualitativeCodingReviewUpsertInput,
} from "./qualitativeCodingReviewPersistence.js";

export interface QualitativeCodingReviewRepository {
  upsertByUploadMetadataId(
    input: QualitativeCodingReviewUpsertInput,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord>;
  findByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord | null>;
  approveIfPending(
    uploadMetadataId: string,
    input: QualitativeCodingReviewApproveInput,
    session: DatabaseSession,
  ): Promise<QualitativeCodingReviewPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
