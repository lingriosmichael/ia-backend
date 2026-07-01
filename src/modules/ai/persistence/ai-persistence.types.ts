import type {
  AIArtifactStatus,
  AIArtifactType,
  AIExecutionStatus,
  AIExecutionType,
} from "../../../shared/contracts.js";

export type StructuredAIPayload = Record<string, unknown> | null;

export interface AIExecutionPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  triggeredById: string;
  jobType: AIExecutionType;
  status: AIExecutionStatus;
  payload: StructuredAIPayload;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIExecutionCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  triggeredById: string;
  jobType: AIExecutionType;
  payload: StructuredAIPayload;
}

export interface AIExecutionUpdateInput {
  status?: AIExecutionStatus;
  payload?: StructuredAIPayload;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface AIArtifactPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  createdById: string;
  resultType: AIArtifactType;
  status: AIArtifactStatus;
  payload: StructuredAIPayload;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIArtifactCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  createdById: string;
  resultType: AIArtifactType;
  payload: StructuredAIPayload;
}

export interface AIArtifactUpdateInput {
  status?: AIArtifactStatus;
  payload?: StructuredAIPayload;
}
