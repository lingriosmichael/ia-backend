export interface PrivacySafeRepresentationPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  privacyReviewId: string;
  parsedRepresentationId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacySafeRepresentationUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  privacyReviewId: string;
  parsedRepresentationId: string;
  payload: Record<string, unknown>;
}
