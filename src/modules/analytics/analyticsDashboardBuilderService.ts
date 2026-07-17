import type {
  AnalyticsDashboard,
  AnalyticsDashboardCategoryRankWidget,
  AnalyticsDashboardWidgetCopyCandidate,
  AnalyticsDashboardWidgetCopySuggestion,
  AnalyticsDashboardGoalLinkage,
  AnalyticsDashboardHorizontalBarWidget,
  AnalyticsDashboardKpiWidget,
  AnalyticsDashboardLineSeriesWidget,
  AnalyticsDashboardQualityFlag,
  AnalyticsDashboardSummaryWidget,
  AnalyticsDashboardThemeListWidget,
  AnalyticsDashboardWidget,
  DashboardCuration,
  EvidenceCatalog,
  EvidenceCatalogMetricEntry,
  EvidenceCatalogThemeEntry,
  ProjectContextForCuration,
} from "./analyticsContracts.js";
import { ANALYTICS_DASHBOARD_SCHEMA_VERSION } from "./analyticsContracts.js";
import type { DeterministicAnalysisPersistenceRecord } from "../interpretation/deterministicAnalysisPersistence.js";

const MAX_DEFAULT_VISIBLE_WIDGETS = 8;
const MAX_DEFAULT_KPI_WIDGETS = 4;
const MAX_BAR_ITEMS = 6;
const MAX_THEME_ITEMS = 5;
const MIN_LINE_POINTS = 2;
const MIN_CATEGORY_ITEMS = 2;

function formatCopyCandidateValue(value: number, unit: string | null): string {
  if (unit === "ratio") {
    return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1).replace(/\.0$/, "");
}

interface WidgetMetadataInput {
  title: string;
  subtitle?: string | null;
  description: string;
  sourceActivityIds: string[];
  sourceUploadMetadataIds: string[];
  outcomeReferences?: string[];
  supportingText: string[];
}

function hasProjectGoalContext(
  projectContext: ProjectContextForCuration,
): boolean {
  return (
    splitGoalPhrases(projectContext.projectGoal).length > 0 ||
    splitGoalPhrases(projectContext.successIndicators).length > 0 ||
    splitGoalPhrases(projectContext.impactModel?.outcomes).length > 0 ||
    splitGoalPhrases(projectContext.impactModel?.impact).length > 0
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function splitGoalPhrases(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\n|[.;]/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= 6);
}

function matchGoalPhrases(
  widgetText: string,
  candidatePhrases: string[],
): string[] {
  const widgetTokens = new Set(tokenize(widgetText));

  return candidatePhrases.filter((phrase) => {
    const phraseTokens = tokenize(phrase);

    if (phraseTokens.length === 0) {
      return false;
    }

    const overlap = phraseTokens.filter((token) => widgetTokens.has(token));
    const minimumOverlap = phraseTokens.length >= 4 ? 2 : 1;
    return overlap.length >= minimumOverlap;
  });
}

function buildQualityFlags(
  catalog: EvidenceCatalog,
  sourceActivityIds: string[],
  sourceUploadMetadataIds: string[],
): AnalyticsDashboardQualityFlag[] {
  return catalog.qualitySignals
    .filter(
      (signal) =>
        sourceUploadMetadataIds.includes(signal.uploadMetadataId) ||
        (signal.activityId !== null &&
          sourceActivityIds.includes(signal.activityId)),
    )
    .map((signal) => ({
      sourceType: signal.sourceType,
      severity: signal.severity,
      message: signal.message,
    }));
}

function buildGoalLinkage(
  projectContext: ProjectContextForCuration,
  widgetText: string,
  outcomeReferences: string[],
): AnalyticsDashboardGoalLinkage {
  const projectGoalPhrases = splitGoalPhrases(projectContext.projectGoal);
  const successIndicatorPhrases = splitGoalPhrases(
    projectContext.successIndicators,
  );
  const impactOutcomePhrases = splitGoalPhrases(
    projectContext.impactModel?.outcomes,
  );
  const impactPhrases = splitGoalPhrases(projectContext.impactModel?.impact);

  return {
    outcomeReferences: uniqueStrings([
      ...outcomeReferences,
      ...matchGoalPhrases(widgetText, impactOutcomePhrases),
      ...matchGoalPhrases(widgetText, impactPhrases),
    ]),
    successIndicators: matchGoalPhrases(widgetText, successIndicatorPhrases),
    matchedProjectGoalPhrases: matchGoalPhrases(widgetText, projectGoalPhrases),
  };
}

function buildWidgetBase(
  catalog: EvidenceCatalog,
  projectContext: ProjectContextForCuration,
  input: WidgetMetadataInput,
) {
  const supportingText = [
    input.title,
    input.description,
    ...input.supportingText,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: input.title,
    subtitle: input.subtitle ?? null,
    description: input.description,
    sourceActivityIds: input.sourceActivityIds,
    sourceUploadMetadataIds: input.sourceUploadMetadataIds,
    goalLinkage: buildGoalLinkage(
      projectContext,
      supportingText,
      input.outcomeReferences ?? [],
    ),
    qualityFlags: buildQualityFlags(
      catalog,
      input.sourceActivityIds,
      input.sourceUploadMetadataIds,
    ),
  };
}

function sortMetricsByPriority(
  metrics: EvidenceCatalogMetricEntry[],
  featuredEntryIds: string[],
) {
  const featuredIndexById = new Map(
    featuredEntryIds.map((entryId, index) => [entryId, index]),
  );

  return [...metrics].sort((left, right) => {
    const leftFeaturedIndex = featuredIndexById.get(left.entryId);
    const rightFeaturedIndex = featuredIndexById.get(right.entryId);

    if (leftFeaturedIndex !== undefined && rightFeaturedIndex !== undefined) {
      return leftFeaturedIndex - rightFeaturedIndex;
    }

    if (leftFeaturedIndex !== undefined) {
      return -1;
    }

    if (rightFeaturedIndex !== undefined) {
      return 1;
    }

    return right.value - left.value;
  });
}

function buildKpiWidgets(
  catalog: EvidenceCatalog,
  curation: DashboardCuration,
  projectContext: ProjectContextForCuration,
): AnalyticsDashboardKpiWidget[] {
  const widgets = sortMetricsByPriority(
    catalog.entries.filter(
      (entry): entry is EvidenceCatalogMetricEntry =>
        entry.entryType === "METRIC",
    ),
    curation.featuredEntryIds,
  ).map((entry): AnalyticsDashboardKpiWidget => ({
    widgetId: `kpi-${entry.entryId}`,
    kind: "kpi",
    ...buildWidgetBase(catalog, projectContext, {
      title: entry.label,
      description: entry.description,
      sourceActivityIds: [entry.activityId],
      sourceUploadMetadataIds: [entry.provenance.uploadMetadataId],
      supportingText: [
        entry.label,
        entry.description,
        entry.provenance.sourceReference,
      ],
    }),
    entryId: entry.entryId,
    label: entry.label,
    value: entry.value,
    unit: entry.unit,
    deduplicationConfidence: entry.deduplicationConfidence,
  }));

  if (!hasProjectGoalContext(projectContext)) {
    return widgets;
  }

  const goalLinkedWidgets = widgets.filter((widget) =>
    isGoalAwareWidget(widget),
  );

  return goalLinkedWidgets.length > 0 ? goalLinkedWidgets : widgets;
}

function buildSummaryWidget(
  catalog: EvidenceCatalog,
  curation: DashboardCuration,
  projectContext: ProjectContextForCuration,
): AnalyticsDashboardSummaryWidget | null {
  if (curation.narrative.length === 0) {
    return null;
  }

  const referencedEntries = catalog.entries.filter((entry) =>
    curation.narrative.some((item) =>
      item.referencedEntryIds.includes(entry.entryId),
    ),
  );

  return {
    widgetId: "summary-primary",
    kind: "summary",
    ...buildWidgetBase(catalog, projectContext, {
      title: "In plain language",
      description:
        "A grounded narrative summary based only on the deterministic evidence catalog.",
      sourceActivityIds: uniqueStrings(
        referencedEntries.flatMap((entry) =>
          entry.entryType === "METRIC"
            ? [entry.activityId]
            : entry.sourceActivityIds,
        ),
      ),
      sourceUploadMetadataIds: uniqueStrings(
        referencedEntries.flatMap((entry) =>
          entry.entryType === "METRIC"
            ? [entry.provenance.uploadMetadataId]
            : entry.sourceUploadMetadataIds,
        ),
      ),
      outcomeReferences: referencedEntries.flatMap((entry) =>
        entry.entryType === "QUALITATIVE_THEME" ? entry.outcomeReferences : [],
      ),
      supportingText: curation.narrative.map((item) => item.text),
    }),
    paragraphs: curation.narrative.map((item) => item.text),
    referencedEntryIds: uniqueStrings(
      curation.narrative.flatMap((item) => item.referencedEntryIds),
    ),
  };
}

function buildComparableMetricsWidgets(
  catalog: EvidenceCatalog,
  projectContext: ProjectContextForCuration,
  deterministicAnalyses: DeterministicAnalysisPersistenceRecord[],
): AnalyticsDashboardHorizontalBarWidget[] {
  const widgets: AnalyticsDashboardHorizontalBarWidget[] = [];

  for (const analysis of deterministicAnalyses) {
    for (const distribution of analysis.distributions) {
      const ratioItems = distribution.buckets
        .filter((bucket) => bucket.ratio !== null && bucket.count > 0)
        .map((bucket) => ({
          id: `${distribution.distributionKey}-${bucket.value ?? "unknown"}-ratio`,
          label: bucket.value ?? "Unknown",
          description: distribution.label,
          value: bucket.ratio as number,
          unit: "ratio",
          entryId: null,
        }))
        .sort((left, right) => right.value - left.value);

      const countItems = distribution.buckets
        .filter((bucket) => bucket.count > 0)
        .map((bucket) => ({
          id: `${distribution.distributionKey}-${bucket.value ?? "unknown"}-count`,
          label: bucket.value ?? "Unknown",
          description: distribution.label,
          value: bucket.count,
          unit: "count",
          entryId: null,
        }))
        .sort((left, right) => right.value - left.value);

      const items =
        ratioItems.length >= MIN_CATEGORY_ITEMS ? ratioItems : countItems;
      const unit = ratioItems.length >= MIN_CATEGORY_ITEMS ? "ratio" : "count";

      if (items.length < MIN_CATEGORY_ITEMS) {
        continue;
      }

      widgets.push({
        widgetId: `horizontal-bar-${analysis.id}-${distribution.distributionKey}-${unit}`,
        kind: "horizontal_bar",
        ...buildWidgetBase(catalog, projectContext, {
          title: distribution.label,
          subtitle: distribution.tableName,
          description:
            "A deterministic category distribution from structured evidence.",
          sourceActivityIds: uniqueStrings([analysis.activityId]),
          sourceUploadMetadataIds: uniqueStrings([analysis.uploadMetadataId]),
          supportingText: [
            distribution.label,
            distribution.tableName,
            distribution.columnName,
          ],
        }),
        unit,
        items: items.slice(0, MAX_BAR_ITEMS),
      });
    }
  }

  return widgets;
}

function buildLineSeriesWidgets(
  catalog: EvidenceCatalog,
  projectContext: ProjectContextForCuration,
  deterministicAnalyses: DeterministicAnalysisPersistenceRecord[],
): AnalyticsDashboardLineSeriesWidget[] {
  const widgets: AnalyticsDashboardLineSeriesWidget[] = [];

  for (const analysis of deterministicAnalyses) {
    for (const trend of analysis.trends) {
      if (trend.points.length < MIN_LINE_POINTS) {
        continue;
      }

      const ratioPoints = trend.points
        .filter((point) => point.positiveRatio !== null)
        .map((point) => ({
          label: point.period,
          value: point.positiveRatio as number,
        }));

      const countPoints = trend.points.map((point) => ({
        label: point.period,
        value: point.rowCount,
      }));

      const candidatePoints =
        ratioPoints.length >= MIN_LINE_POINTS ? ratioPoints : countPoints;
      const unit = ratioPoints.length >= MIN_LINE_POINTS ? "ratio" : "count";

      if (candidatePoints.length < MIN_LINE_POINTS) {
        continue;
      }

      widgets.push({
        widgetId: `line-series-${analysis.id}-${trend.trendKey}-${unit}`,
        kind: "line_series",
        ...buildWidgetBase(catalog, projectContext, {
          title: trend.label,
          subtitle: trend.tableName,
          description:
            "A deterministic time series assembled from prepared, structured evidence.",
          sourceActivityIds: uniqueStrings([analysis.activityId]),
          sourceUploadMetadataIds: uniqueStrings([analysis.uploadMetadataId]),
          supportingText: [trend.label, trend.tableName, trend.dateColumnName],
        }),
        label: trend.label,
        tableName: trend.tableName,
        activityId: analysis.activityId,
        unit,
        points: candidatePoints,
      });
    }
  }

  return widgets;
}

function buildCategoryRankWidgets(
  catalog: EvidenceCatalog,
  projectContext: ProjectContextForCuration,
  deterministicAnalyses: DeterministicAnalysisPersistenceRecord[],
): AnalyticsDashboardCategoryRankWidget[] {
  const widgets: AnalyticsDashboardCategoryRankWidget[] = [];

  for (const analysis of deterministicAnalyses) {
    for (const breakdown of analysis.subgroupBreakdowns) {
      const ratioItems = breakdown.segments
        .filter((segment) => segment.positiveRatio !== null)
        .map((segment) => ({
          id: `${breakdown.breakdownKey}-${segment.value ?? "unknown"}-ratio`,
          label: segment.value ?? "Unknown",
          value: segment.positiveRatio as number,
        }))
        .sort((left, right) => right.value - left.value);

      const countItems = breakdown.segments
        .filter((segment) => segment.rowCount > 0)
        .map((segment) => ({
          id: `${breakdown.breakdownKey}-${segment.value ?? "unknown"}-count`,
          label: segment.value ?? "Unknown",
          value: segment.rowCount,
        }))
        .sort((left, right) => right.value - left.value);

      const items =
        ratioItems.length >= MIN_CATEGORY_ITEMS ? ratioItems : countItems;
      const unit = ratioItems.length >= MIN_CATEGORY_ITEMS ? "ratio" : "count";

      if (items.length < MIN_CATEGORY_ITEMS) {
        continue;
      }

      widgets.push({
        widgetId: `category-rank-${analysis.id}-${breakdown.breakdownKey}-${unit}`,
        kind: "category_rank",
        ...buildWidgetBase(catalog, projectContext, {
          title: breakdown.label,
          subtitle: breakdown.tableName,
          description:
            "A deterministic ranking of categorical segments with comparable underlying evidence.",
          sourceActivityIds: uniqueStrings([analysis.activityId]),
          sourceUploadMetadataIds: uniqueStrings([analysis.uploadMetadataId]),
          supportingText: [
            breakdown.label,
            breakdown.tableName,
            breakdown.columnName,
          ],
        }),
        label: breakdown.label,
        tableName: breakdown.tableName,
        activityId: analysis.activityId,
        unit,
        items: items.slice(0, MAX_BAR_ITEMS),
      });
    }
  }

  return widgets;
}

function buildThemeWidgets(
  catalog: EvidenceCatalog,
  projectContext: ProjectContextForCuration,
): AnalyticsDashboardThemeListWidget[] {
  const themes = catalog.entries
    .filter(
      (entry): entry is EvidenceCatalogThemeEntry =>
        entry.entryType === "QUALITATIVE_THEME",
    )
    .sort((left, right) => right.quoteCount - left.quoteCount);

  if (themes.length === 0) {
    return [];
  }

  return [
    {
      widgetId: "theme-list-primary",
      kind: "theme_list",
      ...buildWidgetBase(catalog, projectContext, {
        title: "Qualitative signals",
        description:
          "The strongest repeated themes carried through into the project knowledge model.",
        sourceActivityIds: uniqueStrings(
          themes.flatMap((theme) => theme.sourceActivityIds),
        ),
        sourceUploadMetadataIds: uniqueStrings(
          themes.flatMap((theme) => theme.sourceUploadMetadataIds),
        ),
        outcomeReferences: themes.flatMap((theme) => theme.outcomeReferences),
        supportingText: themes.flatMap((theme) => [
          theme.label,
          theme.description,
        ]),
      }),
      items: themes.slice(0, MAX_THEME_ITEMS).map((theme) => ({
        entryId: theme.entryId,
        label: theme.label,
        description: theme.description,
        quoteCount: theme.quoteCount,
        outcomeReference: theme.outcomeReferences[0] ?? null,
      })),
    },
  ];
}

function isGoalAwareWidget(widget: AnalyticsDashboardWidget) {
  return (
    widget.goalLinkage.outcomeReferences.length > 0 ||
    widget.goalLinkage.successIndicators.length > 0 ||
    widget.goalLinkage.matchedProjectGoalPhrases.length > 0
  );
}

function featuredReferenceScore(
  widget: AnalyticsDashboardWidget,
  curation: DashboardCuration,
) {
  switch (widget.kind) {
    case "kpi":
      return curation.featuredEntryIds.includes(widget.entryId) ? 18 : 0;
    case "summary":
      return widget.referencedEntryIds.length > 0 ? 22 : 0;
    case "theme_list":
      return widget.items.some((item) =>
        curation.featuredEntryIds.includes(item.entryId),
      )
        ? 12
        : 0;
    default:
      return 0;
  }
}

function widgetKindPriority(widget: AnalyticsDashboardWidget) {
  switch (widget.kind) {
    case "summary":
      return 100;
    case "line_series":
      return 92;
    case "category_rank":
      return 88;
    case "horizontal_bar":
      return 84;
    case "theme_list":
      return 78;
    case "kpi":
      return 74;
  }
}

function widgetScore(
  widget: AnalyticsDashboardWidget,
  curation: DashboardCuration,
) {
  const goalBonus =
    widget.goalLinkage.outcomeReferences.length * 4 +
    widget.goalLinkage.successIndicators.length * 3 +
    widget.goalLinkage.matchedProjectGoalPhrases.length * 5;
  const qualityPenalty = widget.qualityFlags.filter(
    (flag) => flag.severity === "warning",
  ).length;

  return (
    widgetKindPriority(widget) +
    featuredReferenceScore(widget, curation) +
    goalBonus -
    qualityPenalty * 2
  );
}

function deduplicateWidgets(widgets: AnalyticsDashboardWidget[]) {
  const widgetIds = new Set<string>();

  return widgets.filter((widget) => {
    if (widgetIds.has(widget.widgetId)) {
      return false;
    }

    widgetIds.add(widget.widgetId);
    return true;
  });
}

function buildDefaultLayout(
  widgets: AnalyticsDashboardWidget[],
  curation: DashboardCuration,
) {
  const sortedWidgets = [...widgets].sort(
    (left, right) => widgetScore(right, curation) - widgetScore(left, curation),
  );
  const visibleWidgetIds: string[] = [];
  let visibleKpiCount = 0;

  for (const widget of sortedWidgets) {
    if (widget.kind === "kpi") {
      if (visibleKpiCount >= MAX_DEFAULT_KPI_WIDGETS) {
        continue;
      }
      visibleKpiCount += 1;
    }

    visibleWidgetIds.push(widget.widgetId);

    if (visibleWidgetIds.length >= MAX_DEFAULT_VISIBLE_WIDGETS) {
      break;
    }
  }

  if (visibleWidgetIds.length === 0) {
    visibleWidgetIds.push(
      ...sortedWidgets.slice(0, 1).map((widget) => widget.widgetId),
    );
  }

  const hiddenWidgetIds = sortedWidgets
    .filter((widget) => !visibleWidgetIds.includes(widget.widgetId))
    .map((widget) => widget.widgetId);

  return {
    orderedWidgetIds: [...visibleWidgetIds, ...hiddenWidgetIds],
    hiddenWidgetIds,
  };
}

export class AnalyticsDashboardBuilderService {
  build(params: {
    catalog: EvidenceCatalog;
    curation: DashboardCuration;
    deterministicAnalyses: DeterministicAnalysisPersistenceRecord[];
    projectContext: ProjectContextForCuration;
  }): AnalyticsDashboard {
    const widgets = deduplicateWidgets([
      ...buildKpiWidgets(
        params.catalog,
        params.curation,
        params.projectContext,
      ),
      ...[
        buildSummaryWidget(
          params.catalog,
          params.curation,
          params.projectContext,
        ),
      ].filter(
        (widget): widget is AnalyticsDashboardSummaryWidget => widget !== null,
      ),
      ...buildComparableMetricsWidgets(
        params.catalog,
        params.projectContext,
        params.deterministicAnalyses,
      ),
      ...buildLineSeriesWidgets(
        params.catalog,
        params.projectContext,
        params.deterministicAnalyses,
      ),
      ...buildCategoryRankWidgets(
        params.catalog,
        params.projectContext,
        params.deterministicAnalyses,
      ),
      ...buildThemeWidgets(params.catalog, params.projectContext),
    ]).sort((left, right) => {
      const goalAwareDifference =
        Number(isGoalAwareWidget(right)) - Number(isGoalAwareWidget(left));

      if (goalAwareDifference !== 0) {
        return goalAwareDifference;
      }

      return (
        widgetScore(right, params.curation) - widgetScore(left, params.curation)
      );
    });

    return {
      schemaVersion: ANALYTICS_DASHBOARD_SCHEMA_VERSION,
      availableWidgets: widgets,
      defaultLayout: buildDefaultLayout(widgets, params.curation),
    };
  }

  buildWidgetCopyCandidates(
    dashboard: AnalyticsDashboard,
  ): AnalyticsDashboardWidgetCopyCandidate[] {
    return dashboard.availableWidgets
      .filter(
        (widget) =>
          widget.kind === "horizontal_bar" ||
          widget.kind === "line_series" ||
          widget.kind === "category_rank",
      )
      .map((widget) => ({
        widgetId: widget.widgetId,
        kind: widget.kind,
        currentTitle: widget.title,
        currentDescription: widget.description,
        contextLines: this.buildWidgetCopyContextLines(widget),
      }));
  }

  applyWidgetCopySuggestions(
    dashboard: AnalyticsDashboard,
    suggestions: AnalyticsDashboardWidgetCopySuggestion[],
  ): AnalyticsDashboard {
    if (suggestions.length === 0) {
      return dashboard;
    }

    const suggestionsByWidgetId = new Map(
      suggestions.map((suggestion) => [suggestion.widgetId, suggestion]),
    );

    return {
      ...dashboard,
      availableWidgets: dashboard.availableWidgets.map((widget) => {
        const suggestion = suggestionsByWidgetId.get(widget.widgetId);
        if (!suggestion) {
          return widget;
        }

        const title = suggestion.title.trim();
        const description = suggestion.description.trim();

        return {
          ...widget,
          title: title.length > 0 ? title : widget.title,
          description:
            description.length > 0 ? description : widget.description,
        };
      }),
    };
  }

  private buildWidgetCopyContextLines(
    widget:
      | AnalyticsDashboardHorizontalBarWidget
      | AnalyticsDashboardLineSeriesWidget
      | AnalyticsDashboardCategoryRankWidget,
  ): string[] {
    switch (widget.kind) {
      case "horizontal_bar":
        return widget.items.map(
          (item) =>
            `${item.label}: ${formatCopyCandidateValue(item.value, item.unit ?? widget.unit)}`,
        );
      case "line_series":
        return widget.points.map(
          (point) =>
            `${point.label}: ${formatCopyCandidateValue(point.value, widget.unit)}`,
        );
      case "category_rank":
        return widget.items.map(
          (item) =>
            `${item.label}: ${formatCopyCandidateValue(item.value, widget.unit)}`,
        );
    }
  }
}
