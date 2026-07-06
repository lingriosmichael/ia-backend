import type { UploadMetadataStatus } from "../../shared/contracts.js";

export interface UploadMetadataPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadedById: string;
  logicalEvidenceId: string;
  versionNumber: number;
  replacesUploadMetadataId: string | null;
  supersededAt: Date | null;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  originalFileDeletedAt: Date | null;
  status: UploadMetadataStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadMetadataCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadedById: string;
  logicalEvidenceId?: string | null;
  versionNumber?: number | null;
  replacesUploadMetadataId?: string | null;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
}

export interface UploadMetadataUpdateInput {
  contentType?: string | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
  supersededAt?: Date | null;
  originalFileDeletedAt?: Date | null;
  status?: UploadMetadataStatus;
}
