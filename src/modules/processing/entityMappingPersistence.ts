export interface EntityMappingPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  entityType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityMappingReplaceEntry {
  entityType: string;
  payload: Record<string, unknown>;
}

export interface EntityMappingReplaceContext {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
}
