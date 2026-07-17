import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsDashboardEventRepository } from "./analyticsDashboardEventRepository.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { AnalyticsResultPersistenceRecord } from "./analyticsResultPersistence.js";
import {
  CURATOR_MODEL_VERSION,
  type AnalyticsDashboardUsageSummary,
  type AnalyticsScope,
} from "./analyticsContracts.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AnalyticsDashboardPreferencePersistenceRecord } from "./analyticsDashboardPreferencePersistence.js";
import {
  materializeAnalyticsResultDashboard,
  type AnalyticsDashboardCompatibilitySource,
} from "./analyticsDashboardCompatibility.js";

const LIVE_EXECUTION_STATUSES = new Set([
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
]);

export interface AnalyticsQueryResult {
  execution: AnalyticsExecutionPersistenceRecord | null;
  result: AnalyticsResultPersistenceRecord | null;
  layoutPreference: AnalyticsDashboardPreferencePersistenceRecord | null;
  dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource | null;
  dashboardUsageSummary: AnalyticsDashboardUsageSummary | null;
}

function summarizeDashboardUsage(params: {
  resultId: string;
  events: Array<{
    interactionType:
      | "dashboard_viewed"
      | "widget_hidden"
      | "widget_shown"
      | "layout_reordered"
      | "layout_restored";
    occurredAt: Date;
  }>;
}): AnalyticsDashboardUsageSummary | null {
  if (params.events.length === 0) {
    return null;
  }

  let dashboardViewCount = 0;
  let widgetHideCount = 0;
  let widgetShowCount = 0;
  let layoutReorderCount = 0;
  let layoutRestoreCount = 0;
  let lastOccurredAt: Date | null = null;
  let lastViewedAt: Date | null = null;

  for (const event of params.events) {
    lastOccurredAt =
      !lastOccurredAt || event.occurredAt.getTime() > lastOccurredAt.getTime()
        ? event.occurredAt
        : lastOccurredAt;

    switch (event.interactionType) {
      case "dashboard_viewed":
        dashboardViewCount += 1;
        lastViewedAt =
          !lastViewedAt || event.occurredAt.getTime() > lastViewedAt.getTime()
            ? event.occurredAt
            : lastViewedAt;
        break;
      case "widget_hidden":
        widgetHideCount += 1;
        break;
      case "widget_shown":
        widgetShowCount += 1;
        break;
      case "layout_reordered":
        layoutReorderCount += 1;
        break;
      case "layout_restored":
        layoutRestoreCount += 1;
        break;
    }
  }

  return {
    resultId: params.resultId,
    totalEvents: params.events.length,
    dashboardViewCount,
    widgetHideCount,
    widgetShowCount,
    layoutReorderCount,
    layoutRestoreCount,
    lastOccurredAt,
    lastViewedAt,
  };
}

function normalizeLayoutPreference(
  preference: AnalyticsDashboardPreferencePersistenceRecord | null,
  result: AnalyticsResultPersistenceRecord | null,
) {
  if (!preference || !result?.dashboard) {
    return null;
  }

  if (preference.dashboardSchemaVersion !== result.dashboard.schemaVersion) {
    return null;
  }

  const availableWidgetIds = result.dashboard.availableWidgets.map(
    (widget) => widget.widgetId,
  );
  const availableWidgetIdSet = new Set(availableWidgetIds);
  const orderedWidgetIds = [
    ...new Set(
      preference.orderedWidgetIds.filter((widgetId) =>
        availableWidgetIdSet.has(widgetId),
      ),
    ),
    ...availableWidgetIds.filter(
      (widgetId) => !preference.orderedWidgetIds.includes(widgetId),
    ),
  ];
  const hiddenWidgetIds = [...new Set(preference.hiddenWidgetIds)].filter(
    (widgetId) => availableWidgetIdSet.has(widgetId),
  );

  return {
    ...preference,
    orderedWidgetIds,
    hiddenWidgetIds,
  };
}

/**
 * Section 9/11 of "Phase 5 — Deterministic Analytics.md": load the latest
 * result for a scope and apply lazy staleness detection — there is no
 * push-based invalidation trigger anywhere in this codebase (the Project
 * Knowledge Model rebuild itself is the same way: explicit, manual-only),
 * so this re-checks on every read instead.
 */
export class AnalyticsQueryService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly analyticsExecutionRepository: AnalyticsExecutionRepository,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
    private readonly analyticsDashboardPreferenceRepository: AnalyticsDashboardPreferenceRepository,
    private readonly analyticsDashboardEventRepository: AnalyticsDashboardEventRepository,
  ) {}

  async getProjectAnalytics(
    userId: string,
    projectId: string,
  ): Promise<AnalyticsQueryResult> {
    await this.authorizationService.canViewProject(userId, projectId);
    return this.getForScope({ type: "PROJECT", projectId, activityId: null });
  }

  async getActivityAnalytics(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<AnalyticsQueryResult> {
    const { activity } = await this.authorizationService.canViewActivity(
      userId,
      activityId,
    );
    if (activity.projectId !== projectId) {
      throw new AppError(
        "This activity does not belong to the given project.",
        404,
        "activity_not_in_project",
      );
    }

    return this.getForScope({ type: "ACTIVITY", projectId, activityId });
  }

  private async getForScope(
    scope: AnalyticsScope,
  ): Promise<AnalyticsQueryResult> {
    const [execution, result, persistedLayoutPreference] = await Promise.all([
      this.analyticsExecutionRepository.findLatestByScope(
        scope,
        databaseSession,
      ),
      this.analyticsResultRepository.findLatestByScope(scope, databaseSession),
      this.analyticsDashboardPreferenceRepository.findByScope(
        scope,
        databaseSession,
      ),
    ]);

    if (!execution || !result) {
      return {
        execution,
        result: null,
        layoutPreference: null,
        dashboardCompatibilitySource: null,
        dashboardUsageSummary: null,
      };
    }

    if (!LIVE_EXECUTION_STATUSES.has(execution.status)) {
      return {
        execution,
        result: null,
        layoutPreference: null,
        dashboardCompatibilitySource: null,
        dashboardUsageSummary: null,
      };
    }

    const model = await this.projectKnowledgeModelRepository.findByProjectId(
      scope.projectId,
      databaseSession,
    );

    if (model && model.status !== "ready") {
      const updated = await this.analyticsExecutionRepository.updateStatus(
        execution.id,
        { status: "STALE" },
        databaseSession,
      );
      return {
        execution: updated ?? execution,
        result: null,
        layoutPreference: null,
        dashboardCompatibilitySource: null,
        dashboardUsageSummary: null,
      };
    }

    // A result computed with no Project Knowledge Model at all carries
    // knowledgeModelVersion: 0 (see DashboardCatalogAssemblerService's
    // emptyCatalog). If there's still no model, that result is still
    // current relative to "nothing exists yet" — not stale. Only treat a
    // missing model as staleness when the result was actually computed
    // from a real model that has since disappeared (e.g. deleted).
    const isStale = model
      ? model.version !== result.knowledgeModelVersion ||
        result.curation.curatorModelVersion !== CURATOR_MODEL_VERSION
      : result.knowledgeModelVersion !== 0;

    if (!isStale) {
      const materializedResult = materializeAnalyticsResultDashboard(result);
      const dashboardUsageSummary = summarizeDashboardUsage({
        resultId: materializedResult.result.id,
        events:
          await this.analyticsDashboardEventRepository.findByScopeAndResultId(
            scope,
            materializedResult.result.id,
            databaseSession,
          ),
      });
      const layoutPreference = normalizeLayoutPreference(
        persistedLayoutPreference,
        materializedResult.result,
      );
      return {
        execution,
        result: materializedResult.result,
        layoutPreference,
        dashboardCompatibilitySource: materializedResult.source,
        dashboardUsageSummary,
      };
    }

    const updated = await this.analyticsExecutionRepository.updateStatus(
      execution.id,
      { status: "STALE" },
      databaseSession,
    );
    return {
      execution: updated ?? execution,
      result: null,
      layoutPreference: null,
      dashboardCompatibilitySource: null,
      dashboardUsageSummary: null,
    };
  }
}
