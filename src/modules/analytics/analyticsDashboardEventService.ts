import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { AnalyticsDashboardEventRepository } from "./analyticsDashboardEventRepository.js";
import { AppError } from "../../shared/errors/appError.js";
import type {
  AnalyticsDashboardCompatibilitySource,
  AnalyticsDashboardInteractionType,
} from "./analyticsDashboardEventPersistence.js";

function uniqueWidgetIds(widgetIds: string[]) {
  return [...new Set(widgetIds)];
}

function normalizeEventInput(input: {
  resultId: string;
  interactionType: AnalyticsDashboardInteractionType;
  dashboardSchemaVersion: string;
  dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  visibleWidgetIds: string[];
  widgetId: string | null;
}) {
  const orderedWidgetIds = uniqueWidgetIds(input.orderedWidgetIds);
  const hiddenWidgetIds = uniqueWidgetIds(input.hiddenWidgetIds).filter(
    (widgetId) => orderedWidgetIds.includes(widgetId),
  );
  const visibleWidgetIds = uniqueWidgetIds(input.visibleWidgetIds).filter(
    (widgetId) =>
      orderedWidgetIds.includes(widgetId) &&
      !hiddenWidgetIds.includes(widgetId),
  );

  return {
    ...input,
    orderedWidgetIds,
    hiddenWidgetIds,
    visibleWidgetIds,
    widgetId: input.widgetId?.trim() || null,
  };
}

export class AnalyticsDashboardEventService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly analyticsDashboardEventRepository: AnalyticsDashboardEventRepository,
  ) {}

  async trackProjectInteraction(
    userId: string,
    projectId: string,
    input: {
      resultId: string;
      interactionType: AnalyticsDashboardInteractionType;
      dashboardSchemaVersion: string;
      dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
      visibleWidgetIds: string[];
      widgetId: string | null;
    },
  ) {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
    const normalizedInput = normalizeEventInput(input);

    return this.analyticsDashboardEventRepository.create(
      {
        organizationId: project.organizationId,
        projectId,
        activityId: null,
        scopeType: "PROJECT",
        userId,
        resultId: normalizedInput.resultId,
        interactionType: normalizedInput.interactionType,
        dashboardSchemaVersion: normalizedInput.dashboardSchemaVersion,
        dashboardCompatibilitySource:
          normalizedInput.dashboardCompatibilitySource,
        orderedWidgetIds: normalizedInput.orderedWidgetIds,
        hiddenWidgetIds: normalizedInput.hiddenWidgetIds,
        visibleWidgetIds: normalizedInput.visibleWidgetIds,
        widgetId: normalizedInput.widgetId,
        occurredAt: new Date(),
      },
      databaseSession,
    );
  }

  async trackActivityInteraction(
    userId: string,
    projectId: string,
    activityId: string,
    input: {
      resultId: string;
      interactionType: AnalyticsDashboardInteractionType;
      dashboardSchemaVersion: string;
      dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
      visibleWidgetIds: string[];
      widgetId: string | null;
    },
  ) {
    const { project, activity } =
      await this.authorizationService.canViewActivity(userId, activityId);

    if (activity.projectId !== projectId) {
      throw new AppError(
        "This activity does not belong to the given project.",
        404,
        "activity_not_in_project",
      );
    }

    const normalizedInput = normalizeEventInput(input);

    return this.analyticsDashboardEventRepository.create(
      {
        organizationId: project.organizationId,
        projectId,
        activityId,
        scopeType: "ACTIVITY",
        userId,
        resultId: normalizedInput.resultId,
        interactionType: normalizedInput.interactionType,
        dashboardSchemaVersion: normalizedInput.dashboardSchemaVersion,
        dashboardCompatibilitySource:
          normalizedInput.dashboardCompatibilitySource,
        orderedWidgetIds: normalizedInput.orderedWidgetIds,
        hiddenWidgetIds: normalizedInput.hiddenWidgetIds,
        visibleWidgetIds: normalizedInput.visibleWidgetIds,
        widgetId: normalizedInput.widgetId,
        occurredAt: new Date(),
      },
      databaseSession,
    );
  }
}
