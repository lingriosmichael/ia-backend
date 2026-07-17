import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsDashboardPreferencePersistenceRecord,
  AnalyticsDashboardPreferenceUpsertInput,
} from "./analyticsDashboardPreferencePersistence.js";

export interface AnalyticsDashboardPreferenceRepository {
  findByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord | null>;
  upsertByScope(
    input: AnalyticsDashboardPreferenceUpsertInput,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord>;
  deleteByScope(
    scope: AnalyticsScope,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
