import type {
  ImpactIndicatorTileFormat,
  ProjectImpactStoryChartDataKind,
  ProjectImpactStoryChartDatum,
  ProjectImpactStoryChartType,
  ProjectImpactStoryGoalStatus,
  ProjectImpactStoryHeadlineKpi,
} from "../../shared/contracts.js";
import type { ProjectImpactStoryChartPlanKpiCandidate } from "../processing/pythonProcessingClient.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Shared deterministic building blocks for turning a catalog entry (or set
// of entries) into a rendered KPI/chart, reused by both the current
// chart-authoring execution (projectImpactStoryChartAuthoringExecution.ts)
// and the deterministic backlog builder (projectImpactStoryChartBacklog.ts).
// Every number and every chart datum below is computed here, purely from
// the same catalog ia_backend already built — an LLM only ever *selects*
// catalog entryIds and a grouping/aggregation kind, never a value. See
// CURRENT_ANALYSIS_PIPELINE.md's "Python plans, backend executes" invariant
// (Stage 9) — this is the same split applied to the project impact story
// chart plan. The file name predates the chart-authoring redesign
// (2026-08-30), which moved the old top-level orchestration function,
// executeProjectImpactStoryChartPlan, into
// projectImpactStoryChartAuthoringExecution.ts's
// executeProjectImpactStoryChartAuthoring instead — kept unrenamed since
// every export below is still genuinely shared, not chart-plan-specific.

export const PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES: ProjectImpactStoryChartType[] =
  ["bar", "pie", "line", "comparison", "distribution"];

export const PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT = 4;

export interface CalculationKpiEntry {
  entry: Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>;
  value: number;
}

// Deliberately narrow: a before/after pair only ever reads correctly as
// two side-by-side bars. "distribution" (ranked bars) or "pie" would
// visually imply a category breakdown or part-to-whole relationship
// neither exists here, and "line" would falsely suggest a real time
// series instead of two named states.
//
// Reused as-is by projectImpactStoryChartAuthoringExecution.ts for the
// grounded-catalog-only case.
export function isAllowedPairedStoryDeltaChartType(
  chartType: ProjectImpactStoryChartType,
): boolean {
  return chartType === "comparison" || chartType === "bar";
}

export function isAllowedContextDistributionChartType(
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

// Whether one context_distribution entry reads as a genuine part-to-whole
// (pie-worthy) rather than a ranking — a structural property of the data,
// not a domain judgment, so it's decided here instead of trusted from the
// LLM's chartType choice (which proved unreliable at picking pie for this
// shape even under explicit instruction — see chart_plan.py). Deliberately
// mirrors the same two structural gates the chart-plan prompt already
// states: a "few segments" cap (pie stops being readable past ~5 wedges)
// and a "clearly different sizes" spread test (a pie of near-equal wedges
// is unreadable — comparing areas is a much weaker perceptual channel than
// comparing bar lengths).
const CONTEXT_DISTRIBUTION_PIE_MIN_SEGMENTS = 2;
const CONTEXT_DISTRIBUTION_PIE_MAX_SEGMENTS = 5;
const CONTEXT_DISTRIBUTION_PIE_MIN_SPREAD = 0.3;

function isPartToWholeShape(
  entry: Extract<
    ProjectImpactStoryCatalogEntry,
    { kind: "context_distribution" }
  >,
): boolean {
  const counts = entry.shares
    .map((share) => share.count)
    .filter((count) => count > 0);
  if (
    counts.length < CONTEXT_DISTRIBUTION_PIE_MIN_SEGMENTS ||
    counts.length > CONTEXT_DISTRIBUTION_PIE_MAX_SEGMENTS
  ) {
    return false;
  }
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  return (max - min) / max >= CONTEXT_DISTRIBUTION_PIE_MIN_SPREAD;
}

// Resolves the chart type actually rendered for a single context_distribution
// entry, overriding the LLM's candidate.chartType rather than merely
// validating it: pie is forced whenever the data structurally qualifies
// (guaranteeing it shows up, instead of hoping the LLM picks it), and
// downgraded to the safe 'distribution' default whenever the LLM chose pie
// for a shape that doesn't qualify (e.g. near-equal segments), rather than
// shipping a misleading pie.
export function resolveContextDistributionChartType(
  entry: Extract<
    ProjectImpactStoryCatalogEntry,
    { kind: "context_distribution" }
  >,
  candidateChartType: ProjectImpactStoryChartType,
): ProjectImpactStoryChartType {
  if (isPartToWholeShape(entry)) {
    return "pie";
  }
  return candidateChartType === "pie" ? "distribution" : candidateChartType;
}

export function resolveEntries(
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

export function asComparableCalculationKpis(
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
export function computeGoalStatus(
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

export function buildKpi(
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

export function buildPairedStoryDeltaLabels(language: "de" | "en"): {
  beforeLabel: string;
  afterLabel: string;
} {
  return language === "de"
    ? { beforeLabel: "Vorher", afterLabel: "Nachher" }
    : { beforeLabel: "Before", afterLabel: "After" };
}

// Every raw string this file might turn into a rendered bar/category label —
// context_distribution share names, calculation category-rank buckets, and
// calculation tile labels (only actually used for a same-activity
// comparison chart's bars, but collected unconditionally here since which
// branch fires depends on the chart-authoring/backlog grouping, not on the
// catalog alone). Deliberately excludes entry.activityName: an activity's
// name is a stable identifier shown verbatim elsewhere in the product
// (activity list, timeline, uploads) and must never get a second,
// AI-shortened variant that could read differently there — see
// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §2. Over-collection (a string that
// ends up unused by any actual chart) is harmless — DisplayLabelService
// only ever generates for what's actually looked up.
export function collectChartDisplayLabelCandidates(
  entries: ProjectImpactStoryCatalogEntry[],
): string[] {
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "context_distribution") {
      for (const share of entry.shares) {
        candidates.push(share.labelDe);
      }
    } else if (entry.kind === "calculation") {
      candidates.push(entry.tile.label);
      if (entry.tile.kind === "category_rank") {
        for (const bucket of entry.tile.buckets) {
          candidates.push(bucket.category);
        }
      }
    }
  }
  return candidates;
}

// Resolves a raw catalog string to its chart datum shape: `label` carries
// whatever should actually render (the DisplayLabelService-shortened
// version when one was resolved for this exact text, otherwise the raw
// text unchanged), and `rawLabel` is only set when it actually differs, so
// a renderer can show the real value on hover without every datum carrying
// a redundant duplicate field.
export function resolveChartLabel(
  rawText: string,
  displayLabelsByRawText: Map<string, string>,
): Pick<ProjectImpactStoryChartDatum, "label" | "rawLabel"> {
  const resolved = displayLabelsByRawText.get(rawText);
  return resolved && resolved !== rawText
    ? { label: resolved, rawLabel: rawText }
    : { label: rawText };
}

export function buildChartData(
  entries: ProjectImpactStoryCatalogEntry[],
  language: "de" | "en",
  hasGoalProgressChart: boolean,
  displayLabelsByRawText: Map<string, string> = new Map(),
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
          ...resolveChartLabel(share.labelDe, displayLabelsByRawText),
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
          ...resolveChartLabel(bucket.category, displayLabelsByRawText),
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
  // The deterministic "Ziel vs. erreicht" chart (projectImpactStoryGoalProgress.ts)
  // already shows every goal_assessment entry with a resolved measured/
  // target value, ranked by its own progress — whenever it exists, an
  // LLM-proposed chart that re-groups the same entries by status is a
  // duplicate of the same underlying facts at a coarser resolution, not a
  // distinct beat. Drop it here rather than rely on the chart-plan prompt
  // alone to avoid proposing it (see this session's history: prompt-only
  // "don't do X" guidance for chart selection has repeatedly proven
  // unreliable). Only drop when the deterministic chart actually exists —
  // a project whose goals have no measurable target still needs this as
  // its only way to show aggregate goal status.
  if (allGoalAssessments && entries.length > 0 && hasGoalProgressChart) {
    return null;
  }
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
          // Only the same-activity branch (tile.label) goes through
          // DisplayLabelService — the cross-activity branch (activityName)
          // stays fully deterministic on purpose, see
          // collectChartDisplayLabelCandidates's own comment above.
          ...(sameActivity
            ? resolveChartLabel(entry.tile.label, displayLabelsByRawText)
            : { label: entry.activityName }),
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
export function buildChartEntryIdSetSignature(entryIds: string[]): string {
  return [...new Set(entryIds)].sort().join("|");
}
