import { AppError } from "../../shared/errors/appError.js";
import type {
  AnalyticsDashboard,
  AnalyticsDashboardExportDocument,
  AnalyticsDashboardWidget,
} from "./analyticsContracts.js";
import type { AnalyticsDashboardCompatibilitySource } from "./analyticsDashboardCompatibility.js";
import type { AnalyticsQueryService } from "./analyticsQueryService.js";

function buildSectionLines(widget: AnalyticsDashboardWidget): string[] {
  switch (widget.kind) {
    case "kpi":
      return [
        `${widget.label}: ${widget.value}${widget.unit ? ` ${widget.unit}` : ""}`,
      ];
    case "summary":
      return widget.paragraphs;
    case "horizontal_bar":
    case "category_rank":
      return widget.items.map((item) => `${item.label}: ${item.value}`);
    case "line_series":
      return widget.points.map((point) => `${point.label}: ${point.value}`);
    case "theme_list":
      return widget.items.map((item) => item.description);
  }
}

function normalizeRequestedLayout(
  dashboard: AnalyticsDashboard,
  input: {
    orderedWidgetIds: string[];
    hiddenWidgetIds: string[];
  },
) {
  const availableWidgetIds = dashboard.availableWidgets.map(
    (widget) => widget.widgetId,
  );
  const availableWidgetIdSet = new Set(availableWidgetIds);
  const orderedWidgetIds = [
    ...new Set(
      input.orderedWidgetIds.filter((widgetId) =>
        availableWidgetIdSet.has(widgetId),
      ),
    ),
    ...availableWidgetIds.filter(
      (widgetId) => !input.orderedWidgetIds.includes(widgetId),
    ),
  ];
  const hiddenWidgetIds = [...new Set(input.hiddenWidgetIds)].filter(
    (widgetId) => availableWidgetIdSet.has(widgetId),
  );
  const visibleWidgets = orderedWidgetIds
    .filter((widgetId) => !hiddenWidgetIds.includes(widgetId))
    .map((widgetId) =>
      dashboard.availableWidgets.find((widget) => widget.widgetId === widgetId),
    )
    .filter((widget): widget is AnalyticsDashboardWidget => Boolean(widget));

  return {
    orderedWidgetIds,
    hiddenWidgetIds,
    visibleWidgets,
  };
}

export function renderAnalyticsDashboardExportDocumentText(
  document: AnalyticsDashboardExportDocument,
) {
  return [
    "Impact Atlas dashboard export",
    `Scope: ${document.scopeType}`,
    `Project: ${document.projectId}`,
    document.activityId ? `Activity: ${document.activityId}` : null,
    `Schema: ${document.dashboardSchemaVersion}`,
    `Compatibility source: ${document.dashboardCompatibilitySource}`,
    "",
    ...document.sections.flatMap((section) => [
      section.title,
      section.subtitle,
      section.description,
      ...section.lines.map((line) => `- ${line}`),
      "",
    ]),
    ...(document.dataQualityWarnings.length > 0
      ? [
          "Data quality warnings",
          ...document.dataQualityWarnings.map((warning) => `- ${warning}`),
        ]
      : []),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export interface AnalyticsDashboardExportResponse {
  fileName: string;
  contentType: string;
  content: string;
}

export class AnalyticsDashboardExportService {
  constructor(private readonly analyticsQueryService: AnalyticsQueryService) {}

  async exportProjectDashboard(
    userId: string,
    projectId: string,
    input: {
      format: "json" | "text";
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ): Promise<AnalyticsDashboardExportResponse> {
    const analytics = await this.analyticsQueryService.getProjectAnalytics(
      userId,
      projectId,
    );
    return this.buildExportResponse(analytics, input);
  }

  async exportActivityDashboard(
    userId: string,
    projectId: string,
    activityId: string,
    input: {
      format: "json" | "text";
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ): Promise<AnalyticsDashboardExportResponse> {
    const analytics = await this.analyticsQueryService.getActivityAnalytics(
      userId,
      projectId,
      activityId,
    );
    return this.buildExportResponse(analytics, input);
  }

  private buildExportResponse(
    analytics: Awaited<
      ReturnType<AnalyticsQueryService["getProjectAnalytics"]>
    >,
    input: {
      format: "json" | "text";
      dashboardSchemaVersion: string;
      orderedWidgetIds: string[];
      hiddenWidgetIds: string[];
    },
  ): AnalyticsDashboardExportResponse {
    if (!analytics.result?.dashboard) {
      throw new AppError(
        "No analytics dashboard is available for export.",
        409,
        "analytics_dashboard_unavailable",
      );
    }

    if (
      analytics.result.dashboard.schemaVersion !== input.dashboardSchemaVersion
    ) {
      throw new AppError(
        "The dashboard changed while this export was being prepared. Refresh and try again.",
        409,
        "dashboard_schema_version_mismatch",
      );
    }

    const layout = normalizeRequestedLayout(analytics.result.dashboard, input);
    const dashboardCompatibilitySource =
      analytics.dashboardCompatibilitySource ?? ("generated" as const);
    const document = this.buildDocument({
      result: analytics.result,
      dashboardCompatibilitySource,
      hiddenWidgetIds: layout.hiddenWidgetIds,
      visibleWidgets: layout.visibleWidgets,
    });
    const fileBaseName = [
      "impact-atlas-dashboard",
      analytics.result.projectId,
      analytics.result.activityId ?? analytics.result.scopeType.toLowerCase(),
    ].join("-");

    if (input.format === "json") {
      return {
        fileName: `${fileBaseName}.json`,
        contentType: "application/json; charset=utf-8",
        content: JSON.stringify(document, null, 2),
      };
    }

    return {
      fileName: `${fileBaseName}.txt`,
      contentType: "text/plain; charset=utf-8",
      content: renderAnalyticsDashboardExportDocumentText(document),
    };
  }

  private buildDocument(params: {
    result: NonNullable<
      Awaited<
        ReturnType<AnalyticsQueryService["getProjectAnalytics"]>
      >["result"]
    >;
    dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
    hiddenWidgetIds: string[];
    visibleWidgets: AnalyticsDashboardWidget[];
  }): AnalyticsDashboardExportDocument {
    return {
      resultId: params.result.id,
      projectId: params.result.projectId,
      activityId: params.result.activityId,
      scopeType: params.result.scopeType,
      dashboardSchemaVersion: params.result.dashboard!.schemaVersion,
      dashboardCompatibilitySource: params.dashboardCompatibilitySource,
      visibleWidgetIds: params.visibleWidgets.map((widget) => widget.widgetId),
      hiddenWidgetIds: params.hiddenWidgetIds,
      sections: params.visibleWidgets.map((widget) => ({
        widgetId: widget.widgetId,
        kind: widget.kind,
        title: widget.title,
        subtitle: widget.subtitle,
        description: widget.description,
        lines: buildSectionLines(widget),
      })),
      dataQualityWarnings: params.result.dataQuality.warnings,
      generatedAt: new Date(),
    };
  }
}
