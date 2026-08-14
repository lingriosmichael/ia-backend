import type { QualitativeCodingReviewDecisions } from "../../shared/contracts.js";

export type QualitativeCodingReviewStatus = "pending" | "approved" | "rejected";

export interface QualitativeCodingReviewPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  status: QualitativeCodingReviewStatus;
  findings: Record<string, unknown>;
  decisions: QualitativeCodingReviewDecisions | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QualitativeCodingReviewUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  findings: Record<string, unknown>;
}

export interface QualitativeCodingReviewApproveInput {
  decisions: QualitativeCodingReviewDecisions;
  approvedById: string;
  approvedAt: Date;
}
