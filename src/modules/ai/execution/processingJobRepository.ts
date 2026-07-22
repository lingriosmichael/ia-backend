import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import type {
  ProcessingJobCreateInput,
  ProcessingJobPersistenceRecord,
  ProcessingJobUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

export interface ProcessingJobRepository {
  create(
    input: ProcessingJobCreateInput,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord>;
  listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord[]>;
  listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<
    Array<
      Pick<
        ProcessingJobPersistenceRecord,
        | "id"
        | "activityId"
        | "jobType"
        | "status"
        | "createdAt"
        | "updatedAt"
        | "completedAt"
      >
    >
  >;
  countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>>;
  countByProjectStatuses(
    projectId: string,
    statuses: ProcessingJobPersistenceRecord["status"][],
    session: DatabaseSession,
  ): Promise<number>;
  countByProjectTypeStatuses(
    projectId: string,
    jobTypes: ProcessingJobPersistenceRecord["jobType"][],
    statuses: ProcessingJobPersistenceRecord["status"][],
    session: DatabaseSession,
  ): Promise<number>;
  findActiveByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null>;
  deleteByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
  findById(
    processingJobId: string,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null>;
  update(
    processingJobId: string,
    input: ProcessingJobUpdateInput,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord>;
  claimNextRunnable(
    input: {
      workerId: string;
      supportedJobTypes: ProcessingJobPersistenceRecord["jobType"][];
      leaseExpiresAt: Date;
      now: Date;
      claimedStatus: ProcessingJobPersistenceRecord["status"];
    },
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null>;
  renewLease(
    input: {
      processingJobId: string;
      workerId: string;
      leaseExpiresAt: Date;
      heartbeatAt: Date;
    },
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null>;
  cancelIfActive(
    processingJobId: string,
    completedAt: Date,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null>;
}
