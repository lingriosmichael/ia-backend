import type {
  AIArtifactStatus,
  AIArtifactType,
  ProcessingJobStatus,
  ProcessingJobType,
} from "../../../shared/contracts.js";

export type StructuredAIPayload = Record<string, unknown> | null;

export interface ProcessingJobPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  triggeredById: string;
  jobType: ProcessingJobType;
  status: ProcessingJobStatus;
  payload: StructuredAIPayload;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type AIExecutionPersistenceRecord = ProcessingJobPersistenceRecord;

export interface ProcessingJobCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  triggeredById: string;
  jobType: ProcessingJobType;
  payload: StructuredAIPayload;
}
export type AIExecutionCreateInput = ProcessingJobCreateInput;

export interface ProcessingJobUpdateInput {
  status?: ProcessingJobStatus;
  payload?: StructuredAIPayload;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}
export type AIExecutionUpdateInput = ProcessingJobUpdateInput;

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
