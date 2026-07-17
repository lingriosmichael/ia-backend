import type {
  AnalyticsDashboard,
  AnalyticsDashboardWidget,
  DashboardCuration,
  EvidenceCatalog,
  EvidenceCatalogMetricEntry,
  EvidenceCatalogThemeEntry,
} from "./analyticsContracts.js";
import type { AnalyticsResultPersistenceRecord } from "./analyticsResultPersistence.js";

export const FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION =
  "dashboard-fallback-v1";

export type AnalyticsDashboardCompatibilitySource =
  "generated" | "compatibility_fallback";

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function removeUnsafeComparableWidgets(
  dashboard: AnalyticsDashboard,
): AnalyticsDashboard {
  const hasReplacementCharts = dashboard.availableWidgets.some(
    (widget) =>
      widget.kind === "line_series" || widget.kind === "category_rank",
  );

  if (!hasReplacementCharts) {
    return dashboard;
  }

  const availableWidgets = dashboard.availableWidgets.filter(
    (widget) =>
      !(
        widget.kind === "horizontal_bar" &&
        widget.widgetId.startsWith("horizontal-bar-")
      ),
  );

  if (availableWidgets.length === dashboard.availableWidgets.length) {
    return dashboard;
  }

  const availableWidgetIds = new Set(
    availableWidgets.map((widget) => widget.widgetId),
  );

  return {
    ...dashboard,
    availableWidgets,
    defaultLayout: {
      orderedWidgetIds: dashboard.defaultLayout.orderedWidgetIds.filter(
        (widgetId) => availableWidgetIds.has(widgetId),
      ),
      hiddenWidgetIds: dashboard.defaultLayout.hiddenWidgetIds.filter(
        (widgetId) => availableWidgetIds.has(widgetId),
      ),
    },
  };
}

function createFallbackDashboard(params: {
  catalog: EvidenceCatalog;
  curation: DashboardCuration;
}): AnalyticsDashboard {
  const metrics = params.catalog.entries.filter(
    (entry): entry is EvidenceCatalogMetricEntry =>
      entry.entryType === "METRIC",
  );
  const themes = params.catalog.entries.filter(
    (entry): entry is EvidenceCatalogThemeEntry =>
      entry.entryType === "QUALITATIVE_THEME",
  );
  const orderedWidgetIds: string[] = [];
  const availableWidgets: AnalyticsDashboardWidget[] = metrics
    .slice(0, 4)
    .map((entry) => {
      const widgetId = `kpi-${entry.entryId}`;
      orderedWidgetIds.push(widgetId);
      return {
        widgetId,
        kind: "kpi",
        title: entry.label,
        subtitle: null,
        description: entry.description,
        sourceActivityIds: [entry.activityId],
        sourceUploadMetadataIds: [entry.provenance.uploadMetadataId],
        goalLinkage: {
          outcomeReferences: [],
          successIndicators: [],
          matchedProjectGoalPhrases: [],
        },
        qualityFlags: [],
        entryId: entry.entryId,
        label: entry.label,
        value: entry.value,
        unit: entry.unit,
        deduplicationConfidence: entry.deduplicationConfidence,
      };
    });

  if (params.curation.narrative.length > 0) {
    const widgetId = "summary-fallback";
    orderedWidgetIds.push(widgetId);
    availableWidgets.push({
      widgetId,
      kind: "summary",
      title: "In plain language",
      subtitle: null,
      description:
        "A grounded summary assembled from the deterministic evidence catalog.",
      sourceActivityIds: [],
      sourceUploadMetadataIds: [],
      goalLinkage: {
        outcomeReferences: [],
        successIndicators: [],
        matchedProjectGoalPhrases: [],
      },
      qualityFlags: [],
      paragraphs: params.curation.narrative.map((item) => item.text),
      referencedEntryIds: uniqueStrings(
        params.curation.narrative.flatMap((item) => item.referencedEntryIds),
      ),
    });
  }

  if (themes.length > 0) {
    const widgetId = "theme-list-fallback";
    orderedWidgetIds.push(widgetId);
    availableWidgets.push({
      widgetId,
      kind: "theme_list",
      title: "Qualitative signals",
      subtitle: null,
      description: "Repeated themes surfaced in the current catalog.",
      sourceActivityIds: uniqueStrings(
        themes.flatMap((theme) => theme.sourceActivityIds),
      ),
      sourceUploadMetadataIds: uniqueStrings(
        themes.flatMap((theme) => theme.sourceUploadMetadataIds),
      ),
      goalLinkage: {
        outcomeReferences: uniqueStrings(
          themes.flatMap((theme) => theme.outcomeReferences),
        ),
        successIndicators: [],
        matchedProjectGoalPhrases: [],
      },
      qualityFlags: [],
      items: themes.slice(0, 4).map((theme) => ({
        entryId: theme.entryId,
        label: theme.label,
        description: theme.description,
        quoteCount: theme.quoteCount,
        outcomeReference: theme.outcomeReferences[0] ?? null,
      })),
    });
  }

  return {
    schemaVersion: FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
    availableWidgets,
    defaultLayout: {
      orderedWidgetIds,
      hiddenWidgetIds: [],
    },
  };
}

export function resolveAnalyticsDashboard(
  result: Pick<
    AnalyticsResultPersistenceRecord,
    "catalog" | "curation" | "dashboard"
  >,
): {
  dashboard: AnalyticsDashboard;
  source: AnalyticsDashboardCompatibilitySource;
} {
  if (result.dashboard) {
    return {
      dashboard: removeUnsafeComparableWidgets(result.dashboard),
      source: "generated",
    };
  }

  return {
    dashboard: createFallbackDashboard({
      catalog: result.catalog,
      curation: result.curation,
    }),
    source: "compatibility_fallback",
  };
}

export function materializeAnalyticsResultDashboard(
  result: AnalyticsResultPersistenceRecord,
): {
  result: AnalyticsResultPersistenceRecord;
  source: AnalyticsDashboardCompatibilitySource;
} {
  const resolution = resolveAnalyticsDashboard(result);

  if (result.dashboard) {
    return {
      result,
      source: resolution.source,
    };
  }

  return {
    result: {
      ...result,
      dashboard: resolution.dashboard,
    },
    source: resolution.source,
  };
}
