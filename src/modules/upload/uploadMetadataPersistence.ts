import type { UploadMetadataStatus } from "../../shared/contracts.js";

export interface UploadMetadataPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadedById: string;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  status: UploadMetadataStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadMetadataCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadedById: string;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
}

export interface UploadMetadataUpdateInput {
  contentType?: string | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
  status?: UploadMetadataStatus;
}
