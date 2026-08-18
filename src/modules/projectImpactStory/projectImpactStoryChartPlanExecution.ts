import type {
  ImpactIndicatorTileFormat,
  ProjectImpactStoryChartDataKind,
  ProjectImpactStoryChartDatum,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryChartType,
  ProjectImpactStoryHeadlineKpi,
} from "../../shared/contracts.js";
import type {
  ProjectImpactStoryChartPlanChartCandidate,
  ProjectImpactStoryChartPlanKpiCandidate,
} from "../processing/pythonProcessingClient.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Deterministic validation + execution of Python's chart-plan proposal.
// Python only ever *selects* catalog entryIds and an aggregation/grouping
// kind; every number and every chart datum below is computed here, purely
// from the same catalog ia_backend already built and sent — never trusted
// from the Python response, which carries no numeric fields to trust in the
// first place. See CURRENT_ANALYSIS_PIPELINE.md's "Python plans, backend
// executes" invariant (Stage 9) — this is the same split applied to the
// project impact story chart plan.

export const PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES: ProjectImpactStoryChartType[] =
  ["bar", "pie", "line", "comparison", "distribution"];

export const PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT = 4;

export interface ProjectImpactStoryChartPlanExecutionResult {
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  droppedKpiCount: number;
  droppedChartCount: number;
}

interface CalculationKpiEntry {
  entry: Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>;
  value: number;
}

function resolveEntries(
  entryIds: string[],
  entriesById: Map<string, ProjectImpactStoryCatalogEntry>,
): ProjectImpactStoryCatalogEntry[] | null {
  const resolved: ProjectImpactStoryCatalogEntry[] = [];
  for (const entryId of entryIds) {
    const entry = entriesById.get(entryId);
    // Defense in depth: Python's own grounding validator already rejects an
    // unknown entryId, but this backend copy of the catalog is the actual
    // source of truth, so it re-checks rather than trusting that check ran.
    if (!entry) {
      return null;
    }
    resolved.push(entry);
  }
  return resolved;
}

function asComparableCalculationKpis(
  entries: ProjectImpactStoryCatalogEntry[],
): CalculationKpiEntry[] | null {
  const calculationKpis: CalculationKpiEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "calculation" || entry.tile.kind !== "kpi") {
      return null;
    }
    if (entry.tile.value === null) {
      return null;
    }
    calculationKpis.push({ entry, value: entry.tile.value });
  }

  if (calculationKpis.length === 0) {
    return null;
  }

  // Structural-comparability gate: entries may only be combined
  // arithmetically (sum/average, or shown side by side as a "comparison"
  // chart) if they measure the literally same thing — same tool, same
  // unit, same denominator basis. This applies regardless of whether the
  // entries come from one activity or several: summing incompatible
  // measures is wrong either way, but it is the cross-activity case this
  // gate exists to prevent (see CURRENT_ANALYSIS_PIPELINE.md discussion of
  // why the narrative endpoint refuses to sum across activities).
  const [first, ...rest] = calculationKpis;
  const isComparable = rest.every(
    (candidate) =>
      candidate.entry.toolName === first!.entry.toolName &&
      candidate.entry.unit === first!.entry.unit &&
      candidate.entry.denominatorType === first!.entry.denominatorType,
  );

  return isComparable ? calculationKpis : null;
}

function buildKpi(
  candidate: ProjectImpactStoryChartPlanKpiCandidate,
  entriesById: Map<string, ProjectImpactStoryCatalogEntry>,
): ProjectImpactStoryHeadlineKpi | null {
  const entries = resolveEntries(candidate.entryIds, entriesById);
  if (!entries || entries.length === 0) {
    return null;
  }

  if (candidate.aggregation === "count") {
    return {
      kpiId: candidate.kpiId,
      label: candidate.label,
      value: entries.length,
      formatAs: "number",
      narrativeReason: candidate.narrativeReason,
    };
  }

  const calculationKpis = asComparableCalculationKpis(entries);
  if (!calculationKpis) {
    return null;
  }

  if (candidate.aggregation === "single") {
    if (calculationKpis.length !== 1) {
      return null;
    }
    const [only] = calculationKpis;
    return {
      kpiId: candidate.kpiId,
      label: candidate.label,
      value: only!.value,
      formatAs:
        only!.entry.tile.kind === "kpi" ? only!.entry.tile.formatAs : "number",
      narrativeReason: candidate.narrativeReason,
    };
  }

  const total = calculationKpis.reduce((sum, item) => sum + item.value, 0);
  const value =
    candidate.aggregation === "average"
      ? total / calculationKpis.length
      : total;
  const sharedUnit = calculationKpis[0]!.entry.unit;

  return {
    kpiId: candidate.kpiId,
    label: candidate.label,
    value,
    formatAs: sharedUnit === "ratio" ? "percentage" : "number",
    narrativeReason: candidate.narrativeReason,
  };
}

function buildTrendChartData(
  entry: Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>,
): { data: ProjectImpactStoryChartDatum[]; isRatio: boolean } {
  if (entry.tile.kind !== "line_series") {
    return { data: [], isRatio: false };
  }
  // A trend's points all come from the same underlying calculation, so
  // "is this a ratio series" is a property of the tile as a whole, not
  // something that varies point to point — same reasoning as
  // impactStoryTrendChart.tsx's trendFormat helper on the frontend.
  const isRatio = entry.tile.points.some(
    (point) => point.numeratorCount !== null && point.denominatorCount !== null,
  );
  const data = entry.tile.points.flatMap(
    (point): ProjectImpactStoryChartDatum[] => {
      if (
        point.numeratorCount !== null &&
        point.denominatorCount !== null &&
        point.denominatorCount > 0
      ) {
        return [
          {
            label: point.period,
            value: point.numeratorCount / point.denominatorCount,
          },
        ];
      }
      if (point.count !== null) {
        return [{ label: point.period, value: point.count }];
      }
      return [];
    },
  );
  return { data, isRatio };
}

function buildChartData(entries: ProjectImpactStoryCatalogEntry[]): {
  data: ProjectImpactStoryChartDatum[];
  dataKind: ProjectImpactStoryChartDataKind;
  valueFormat: ImpactIndicatorTileFormat;
} | null {
  if (entries.length === 1) {
    const [entry] = entries;
    if (entry!.kind === "calculation" && entry!.tile.kind === "category_rank") {
      return {
        dataKind: "category",
        valueFormat: "number",
        data: entry!.tile.buckets.map((bucket) => ({
          label: bucket.category,
          value: bucket.count,
        })),
      };
    }
    if (entry!.kind === "calculation" && entry!.tile.kind === "line_series") {
      const { data, isRatio } = buildTrendChartData(
        entry as Extract<
          ProjectImpactStoryCatalogEntry,
          { kind: "calculation" }
        >,
      );
      return data.length > 0
        ? {
            dataKind: "period",
            valueFormat: isRatio ? "percentage" : "number",
            data,
          }
        : null;
    }
  }

  const allGoalAssessments = entries.every(
    (entry) => entry.kind === "goal_assessment",
  );
  if (allGoalAssessments && entries.length > 0) {
    const countByStatus = new Map<string, number>();
    for (const entry of entries) {
      if (entry.kind !== "goal_assessment") {
        continue;
      }
      countByStatus.set(
        entry.assessmentStatus,
        (countByStatus.get(entry.assessmentStatus) ?? 0) + 1,
      );
    }
    return {
      dataKind: "status",
      valueFormat: "number",
      data: Array.from(countByStatus.entries()).map(([label, value]) => ({
        label,
        value,
      })),
    };
  }

  if (entries.length > 1) {
    const calculationKpis = asComparableCalculationKpis(entries);
    if (calculationKpis) {
      const sharedUnit = calculationKpis[0]!.entry.unit;
      // The structural-comparability gate only guarantees the entries
      // measure the same *kind* of thing (toolName/unit/denominatorType) —
      // it says nothing about whether they come from one activity or many.
      // Labeling every bar with activityName is only correct in the
      // cross-activity case (the same measure repeated per activity, where
      // activityName is exactly the distinguishing fact). When every entry
      // instead shares one activityId — several different measures being
      // compared within a single activity, e.g. applications vs. selected
      // mentors — activityName is identical across every bar and tells the
      // reader nothing; the calculation's own plain-language label is the
      // actual distinguishing fact there.
      const sameActivity = calculationKpis.every(
        ({ entry }) =>
          entry.activityId === calculationKpis[0]!.entry.activityId,
      );
      return {
        dataKind: "activity",
        valueFormat: sharedUnit === "ratio" ? "percentage" : "number",
        data: calculationKpis.map(({ entry, value }) => ({
          label: sameActivity ? entry.tile.label : entry.activityName,
          value,
        })),
      };
    }
  }

  return null;
}

function buildChart(
  candidate: ProjectImpactStoryChartPlanChartCandidate,
  entriesById: Map<string, ProjectImpactStoryCatalogEntry>,
): ProjectImpactStoryChartSpec | null {
  if (
    !PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES.includes(
      candidate.chartType as ProjectImpactStoryChartType,
    )
  ) {
    return null;
  }

  const entries = resolveEntries(candidate.entryIds, entriesById);
  if (!entries || entries.length === 0) {
    return null;
  }

  const built = buildChartData(entries);
  if (!built || built.data.length === 0) {
    return null;
  }

  return {
    chartId: candidate.chartId,
    chartType: candidate.chartType as ProjectImpactStoryChartType,
    dataKind: built.dataKind,
    valueFormat: built.valueFormat,
    title: candidate.title,
    subtitle: candidate.subtitle ?? null,
    narrativeReason: candidate.narrativeReason,
    data: built.data,
  };
}

export function executeProjectImpactStoryChartPlan(
  catalog: ProjectImpactStoryCatalogEntry[],
  planResponse: {
    headlineKpis: ProjectImpactStoryChartPlanKpiCandidate[];
    chartPlan: ProjectImpactStoryChartPlanChartCandidate[];
  },
): ProjectImpactStoryChartPlanExecutionResult {
  const entriesById = new Map(catalog.map((entry) => [entry.entryId, entry]));

  const headlineKpis: ProjectImpactStoryHeadlineKpi[] = [];
  let droppedKpiCount = 0;
  for (const candidate of planResponse.headlineKpis) {
    const kpi = buildKpi(candidate, entriesById);
    if (kpi) {
      headlineKpis.push(kpi);
    } else {
      droppedKpiCount += 1;
    }
  }

  const chartPlan: ProjectImpactStoryChartSpec[] = [];
  let droppedChartCount = 0;
  for (const candidate of planResponse.chartPlan) {
    const chart = buildChart(candidate, entriesById);
    if (chart) {
      chartPlan.push(chart);
    } else {
      droppedChartCount += 1;
    }
  }

  return { headlineKpis, chartPlan, droppedKpiCount, droppedChartCount };
}
