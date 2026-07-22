import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsExecutionCreateInput,
  AnalyticsExecutionPersistenceRecord,
  AnalyticsExecutionUpdateInput,
} from "./analyticsExecutionPersistence.js";

export interface AnalyticsExecutionRepository {
  create(
    input: AnalyticsExecutionCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord>;
  update(
    id: string,
    update: AnalyticsExecutionUpdateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  findById(
    id: string,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  findLatestByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  claimNextRunnable(
    input: {
      workerId: string;
      leaseExpiresAt: Date;
      now: Date;
      claimedStatus: "RUNNING";
    },
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  renewLease(
    input: {
      analyticsExecutionId: string;
      workerId: string;
      leaseExpiresAt: Date;
      heartbeatAt: Date;
    },
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
