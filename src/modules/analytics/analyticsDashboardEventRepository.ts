import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import type {
  AnalyticsDashboardEventCreateInput,
  AnalyticsDashboardEventPersistenceRecord,
} from "./analyticsDashboardEventPersistence.js";

export interface AnalyticsDashboardEventRepository {
  create(
    input: AnalyticsDashboardEventCreateInput,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardEventPersistenceRecord>;
  findByScopeAndResultId(
    scope: AnalyticsScope,
    resultId: string,
    session: DatabaseSession,
  ): Promise<AnalyticsDashboardEventPersistenceRecord[]>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
