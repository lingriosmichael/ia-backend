import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { AnalyticsScope } from "./analyticsContracts.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AnalyticsDashboardPreferencePersistenceRecord } from "./analyticsDashboardPreferencePersistence.js";
import { resolveAnalyticsDashboard } from "./analyticsDashboardCompatibility.js";

function uniqueWidgetIds(widgetIds: string[]) {
  return [...new Set(widgetIds)];
}

export class AnalyticsDashboardPreferenceService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
    private readonly analyticsDashboardPreferenceRepository: AnalyticsDashboardPreferenceRepository,
  ) {}

  async updateProjectPreference(
    userId: string,
    projectId: string,
    input: {
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    return this.updateForScope(
      userId,
      {
        type: "PROJECT",
        projectId,
        activityId: null,
      },
      project.organizationId,
      input,
    );
  }

  async resetProjectPreference(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await this.authorizationService.canViewProject(userId, projectId);
    await this.analyticsDashboardPreferenceRepository.deleteByScope(
      {
        type: "PROJECT",
        projectId,
        activityId: null,
      },
      databaseSession,
    );
  }

  async updateActivityPreference(
    userId: string,
    projectId: string,
    activityId: string,
    input: {
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ): Promise<AnalyticsDashboardPreferencePersistenceRecord> {
    const { project, activity } =
      await this.authorizationService.canViewActivity(userId, activityId);

    if (activity.projectId !== projectId) {
      throw new AppError(
        "This activity does not belong to the given project.",
        404,
        "activity_not_in_project",
      );
    }

    return this.updateForScope(
      userId,
      {
        type: "ACTIVITY",
        projectId,
        activityId,
      },
      project.organizationId,
      input,
    );
  }

  async resetActivityPreference(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<void> {
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

    await this.analyticsDashboardPreferenceRepository.deleteByScope(
      {
        type: "ACTIVITY",
        projectId,
        activityId,
      },
      databaseSession,
    );
  }

  private async updateForScope(
    userId: string,
    scope: AnalyticsScope,
    organizationId: string,
    input: {
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ) {
    const result = await this.analyticsResultRepository.findLatestByScope(
      scope,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "No generated dashboard is available for this scope yet.",
        400,
        "analytics_dashboard_not_generated",
      );
    }

    const resolvedDashboard = resolveAnalyticsDashboard(result).dashboard;

    if (resolvedDashboard.schemaVersion !== input.dashboardSchemaVersion) {
      throw new AppError(
        "The dashboard schema version does not match the current generated dashboard.",
        409,
        "analytics_dashboard_schema_mismatch",
      );
    }

    const availableWidgetIds = resolvedDashboard.availableWidgets.map(
      (widget) => widget.widgetId,
    );
    const availableWidgetIdSet = new Set(availableWidgetIds);
    const orderedWidgetIds = uniqueWidgetIds(input.orderedWidgetIds);
    const hiddenWidgetIds = uniqueWidgetIds(input.hiddenWidgetIds);

    if (
      orderedWidgetIds.some(
        (widgetId) => !availableWidgetIdSet.has(widgetId),
      ) ||
      hiddenWidgetIds.some((widgetId) => !availableWidgetIdSet.has(widgetId))
    ) {
      throw new AppError(
        "The dashboard preference references widgets that are not available for this dashboard.",
        400,
        "analytics_dashboard_invalid_widget_reference",
      );
    }

    const orderedWithMissingAppended = [
      ...orderedWidgetIds,
      ...availableWidgetIds.filter(
        (widgetId) => !orderedWidgetIds.includes(widgetId),
      ),
    ];

    return this.analyticsDashboardPreferenceRepository.upsertByScope(
      {
        organizationId,
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
        dashboardSchemaVersion: input.dashboardSchemaVersion,
        orderedWidgetIds: orderedWithMissingAppended,
        hiddenWidgetIds: hiddenWidgetIds.filter((widgetId) =>
          orderedWithMissingAppended.includes(widgetId),
        ),
        updatedById: userId,
      },
      databaseSession,
    );
  }
}
