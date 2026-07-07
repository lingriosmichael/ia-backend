import type {
  ProcessingJobStatus,
  ProcessingJobType,
  ResultRecordStatus,
  ResultRecordType,
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

export interface ResultRecordPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  createdById: string;
  resultType: ResultRecordType;
  status: ResultRecordStatus;
  payload: StructuredAIPayload;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResultRecordCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  createdById: string;
  resultType: ResultRecordType;
  payload: StructuredAIPayload;
}

export interface ResultRecordUpdateInput {
  status?: ResultRecordStatus;
  payload?: StructuredAIPayload;
}
