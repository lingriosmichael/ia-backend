export type ParsedRepresentationFileType =
  "spreadsheet" | "document" | "unknown";

export interface ParsedRepresentationPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  fileType: ParsedRepresentationFileType;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedRepresentationUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  fileType: ParsedRepresentationFileType;
  payload: Record<string, unknown>;
}
