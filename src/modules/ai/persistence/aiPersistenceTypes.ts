import type {
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
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  failureCode: string | null;
  maxAttempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessingJobCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  triggeredById: string;
  jobType: ProcessingJobType;
  payload: StructuredAIPayload;
}

export interface ProcessingJobUpdateInput {
  status?: ProcessingJobStatus;
  payload?: StructuredAIPayload;
  errorMessage?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  failureCode?: string | null;
  maxAttempts?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
}
