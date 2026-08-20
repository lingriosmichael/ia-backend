import type {
  ImpactIndicatorTileFormat,
  ProjectImpactStoryChartDataKind,
  ProjectImpactStoryChartDatum,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryChartType,
  ProjectImpactStoryGoalStatus,
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
  // Every catalog entryId that actually made it into a rendered KPI or
  // chart — i.e. "selected" means visible on the page, not merely
  // requested by Python (a requested entryId whose candidate got dropped
  // below, e.g. an incompatible chart type, was never actually selected
  // in any sense a reader would recognize). Feeds
  // projectChartSelectionAudit.ts's diff against the opportunity audit's
  // ready_now set.
  selectedEntryIds: string[];
}

interface CalculationKpiEntry {
  entry: Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>;
  value: number;
}

// Deliberately narrow: a before/after pair only ever reads correctly as
// two side-by-side bars. "distribution" (ranked bars) or "pie" would
// visually imply a category breakdown or part-to-whole relationship
// neither exists here, and "line" would falsely suggest a real time
// series instead of two named states.
function isAllowedPairedStoryDeltaChartType(
  chartType: ProjectImpactStoryChartType,
): boolean {
  return chartType === "comparison" || chartType === "bar";
}

function isAllowedContextDistributionChartType(
  entry: Extract<
    ProjectImpactStoryCatalogEntry,
    { kind: "context_distribution" }
  >,
  chartType: ProjectImpactStoryChartType,
): boolean {
  if (
    chartType === "distribution" &&
    entry.eligibleChartTypes.includes("hbar_target")
  ) {
    return true;
  }
  if (chartType === "bar" && entry.eligibleChartTypes.includes("hbar_target")) {
    return true;
  }
  if (chartType === "pie" && entry.eligibleChartTypes.includes("donut_share")) {
    return true;
  }
  return false;
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

// A goal is "close enough" to count as warn rather than risk once its
// measured value reaches this fraction of target. A fixed, documented
// threshold rather than a per-goal tunable — see
// IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §3.3. Adjust here if product
// feedback says 80% reads wrong for this domain.
const PROJECT_IMPACT_STORY_GOAL_WARN_THRESHOLD = 0.8;

// Recomputed from measuredValue/targetValue every time a KPI is built —
// never read from an evidence-embedded "target met" flag. `comparison`
// governs which direction counts as progress: at_least/equal goals track
// measuredValue as a fraction of target; at_most goals (a ceiling, e.g. "no
// more than X dropouts") track how far measuredValue exceeds the allowed
// target instead, since "achieved" there means staying at or under it.
function computeGoalStatus(
  achieved: boolean | null,
  measuredValue: number | null,
  targetValue: number | null,
  comparison: "at_least" | "at_most" | "equal" | null,
): ProjectImpactStoryGoalStatus | null {
  if (
    achieved === null ||
    measuredValue === null ||
    targetValue === null ||
    targetValue === 0
  ) {
    return null;
  }
  if (achieved) {
    return "good";
  }

  const progressRatio =
    comparison === "at_most"
      ? targetValue / measuredValue
      : measuredValue / targetValue;

  return progressRatio >= PROJECT_IMPACT_STORY_GOAL_WARN_THRESHOLD
    ? "warn"
    : "risk";
}

function buildGoalStatusCallout(
  status: ProjectImpactStoryGoalStatus,
  measuredValue: number,
  targetValue: number,
  language: "de" | "en",
): string | undefined {
  if (status === "good") {
    return undefined;
  }
  const progressPct = Math.round((measuredValue / targetValue) * 100);
  return language === "de"
    ? `Braucht Aufmerksamkeit: Ziel bisher zu ${progressPct}% erreicht.`
    : `Needs attention: ${progressPct}% of target reached so far.`;
}

function buildGoalAssessmentKpi(
  candidate: ProjectImpactStoryChartPlanKpiCandidate,
  entry: Extract<ProjectImpactStoryCatalogEntry, { kind: "goal_assessment" }>,
  language: "de" | "en",
): ProjectImpactStoryHeadlineKpi | null {
  if (entry.measuredValue === null || entry.targetValue === null) {
    return null;
  }

  const status = computeGoalStatus(
    entry.achieved,
    entry.measuredValue,
    entry.targetValue,
    entry.comparison,
  );

  return {
    kpiId: candidate.kpiId,
    label: candidate.label,
    value: entry.measuredValue,
    formatAs: "number",
    narrativeReason: candidate.narrativeReason,
    ...(status ? { status } : {}),
    ...(status && status !== "good"
      ? {
          statusCallout: buildGoalStatusCallout(
            status,
            entry.measuredValue,
            entry.targetValue,
            language,
          ),
        }
      : {}),
  };
}

function buildKpi(
  candidate: ProjectImpactStoryChartPlanKpiCandidate,
  entriesById: Map<string, ProjectImpactStoryCatalogEntry>,
  language: "de" | "en",
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

  if (
    candidate.aggregation === "single" &&
    entries.length === 1 &&
    entries[0]!.kind === "goal_assessment"
  ) {
    return buildGoalAssessmentKpi(candidate, entries[0]!, language);
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

function buildPairedStoryDeltaLabels(language: "de" | "en"): {
  beforeLabel: string;
  afterLabel: string;
} {
  return language === "de"
    ? { beforeLabel: "Vorher", afterLabel: "Nachher" }
    : { beforeLabel: "Before", afterLabel: "After" };
}

function buildChartData(
  entries: ProjectImpactStoryCatalogEntry[],
  language: "de" | "en",
): {
  data: ProjectImpactStoryChartDatum[];
  dataKind: ProjectImpactStoryChartDataKind;
  valueFormat: ImpactIndicatorTileFormat;
} | null {
  if (entries.length === 1) {
    const [entry] = entries;
    if (entry!.kind === "context_distribution") {
      return {
        dataKind: "category",
        valueFormat: "number",
        data: entry!.shares.map((share) => ({
          label: share.labelDe,
          value: share.count,
        })),
      };
    }
    if (entry!.kind === "paired_story_delta") {
      const { beforeLabel, afterLabel } = buildPairedStoryDeltaLabels(language);
      return {
        dataKind: "category",
        valueFormat: "number",
        data: [
          { label: beforeLabel, value: entry!.beforeValue },
          { label: afterLabel, value: entry!.afterValue },
        ],
      };
    }
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

// Order-independent identity for "which catalog entries does this chart
// visualize" — two chart candidates with the same signature show the
// literal same underlying facts, regardless of chart type/title/subtitle,
// and the second one adds no information the first didn't already.
function buildChartEntryIdSetSignature(entryIds: string[]): string {
  return [...new Set(entryIds)].sort().join("|");
}

function buildChart(
  candidate: ProjectImpactStoryChartPlanChartCandidate,
  entriesById: Map<string, ProjectImpactStoryCatalogEntry>,
  language: "de" | "en",
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

  if (
    entries.length === 1 &&
    entries[0]!.kind === "context_distribution" &&
    !isAllowedContextDistributionChartType(
      entries[0]!,
      candidate.chartType as ProjectImpactStoryChartType,
    )
  ) {
    return null;
  }

  const isExploratory =
    entries.length === 1 && entries[0]!.kind === "paired_story_delta";
  if (
    isExploratory &&
    !isAllowedPairedStoryDeltaChartType(
      candidate.chartType as ProjectImpactStoryChartType,
    )
  ) {
    return null;
  }

  const built = buildChartData(entries, language);
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
    ...(isExploratory ? { isExploratory: true } : {}),
  };
}

export function executeProjectImpactStoryChartPlan(
  catalog: ProjectImpactStoryCatalogEntry[],
  planResponse: {
    headlineKpis: ProjectImpactStoryChartPlanKpiCandidate[];
    chartPlan: ProjectImpactStoryChartPlanChartCandidate[];
  },
  // Defaults to "de" so existing callers/tests that only exercise
  // language-agnostic aggregations (count/sum/average/single-calculation)
  // are unaffected; only the goal-assessment statusCallout text below
  // actually varies by language.
  language: "de" | "en" = "de",
): ProjectImpactStoryChartPlanExecutionResult {
  const entriesById = new Map(catalog.map((entry) => [entry.entryId, entry]));
  const selectedEntryIds = new Set<string>();

  const headlineKpis: ProjectImpactStoryHeadlineKpi[] = [];
  let droppedKpiCount = 0;
  for (const candidate of planResponse.headlineKpis) {
    const kpi = buildKpi(candidate, entriesById, language);
    if (kpi) {
      headlineKpis.push(kpi);
      for (const entryId of candidate.entryIds) {
        selectedEntryIds.add(entryId);
      }
    } else {
      droppedKpiCount += 1;
    }
  }

  const chartPlan: ProjectImpactStoryChartSpec[] = [];
  let droppedChartCount = 0;
  // Only ever populated by an *accepted* chart's own signature (never a
  // candidate's, before it's known to be valid) — otherwise a later,
  // genuinely valid candidate could be wrongly dropped as "redundant" of
  // an earlier candidate that itself never made it into chartPlan.
  const acceptedChartEntryIdSetSignatures = new Set<string>();
  for (const candidate of planResponse.chartPlan) {
    const signature = buildChartEntryIdSetSignature(candidate.entryIds);
    if (acceptedChartEntryIdSetSignatures.has(signature)) {
      // Lightweight deterministic redundancy guard, not a second ranking
      // engine: an earlier chart in this same plan already visualizes the
      // identical set of catalog entries, so this one adds no information
      // regardless of its own chart type/title — reject it rather than
      // trust the prompt's "don't duplicate" instruction alone.
      droppedChartCount += 1;
      continue;
    }

    const chart = buildChart(candidate, entriesById, language);
    if (chart) {
      chartPlan.push(chart);
      acceptedChartEntryIdSetSignatures.add(signature);
      for (const entryId of candidate.entryIds) {
        selectedEntryIds.add(entryId);
      }
    } else {
      droppedChartCount += 1;
    }
  }

  return {
    headlineKpis,
    chartPlan,
    droppedKpiCount,
    droppedChartCount,
    selectedEntryIds: [...selectedEntryIds],
  };
}
