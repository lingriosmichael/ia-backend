import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  PrivacyReviewApproveInput,
  PrivacyReviewPersistenceRecord,
  PrivacyReviewUpsertInput,
} from "./privacyReviewPersistence.js";

export interface PrivacyReviewRepository {
  upsertByProcessingJobId(
    input: PrivacyReviewUpsertInput,
    session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord>;
  findByProcessingJobId(
    processingJobId: string,
    session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord | null>;
  /**
   * Atomically approves the review only if it is still "pending". Returns
   * null if the review was not found or had already left "pending" (e.g. a
   * concurrent approval) — the caller decides which error that maps to.
   */
  approveIfPending(
    processingJobId: string,
    input: PrivacyReviewApproveInput,
    session: DatabaseSession,
  ): Promise<PrivacyReviewPersistenceRecord | null>;
  deleteByProjectId(projectId: string, session: DatabaseSession): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
