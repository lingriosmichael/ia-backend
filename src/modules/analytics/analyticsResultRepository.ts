import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsResultCreateInput,
  AnalyticsResultPersistenceRecord,
} from "./analyticsResultPersistence.js";

export interface AnalyticsResultRepository {
  create(
    input: AnalyticsResultCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsResultPersistenceRecord>;
  findLatestByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsResultPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
