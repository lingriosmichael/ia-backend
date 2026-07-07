import type { PrivacyReviewDecisions } from "../../shared/contracts.js";

export type PrivacyReviewStatus = "pending" | "approved" | "rejected";

export interface PrivacyReviewPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  status: PrivacyReviewStatus;
  findings: Record<string, unknown>;
  decisions: PrivacyReviewDecisions | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacyReviewUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  findings: Record<string, unknown>;
}

export interface PrivacyReviewApproveInput {
  decisions: PrivacyReviewDecisions;
  approvedById: string;
  approvedAt: Date;
}
