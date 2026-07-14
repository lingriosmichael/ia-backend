import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsExecutionCreateInput,
  AnalyticsExecutionPersistenceRecord,
  AnalyticsExecutionStatusUpdate,
} from "./analyticsExecutionPersistence.js";

export interface AnalyticsExecutionRepository {
  create(
    input: AnalyticsExecutionCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord>;
  updateStatus(
    id: string,
    update: AnalyticsExecutionStatusUpdate,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
  findLatestByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsExecutionPersistenceRecord | null>;
}
