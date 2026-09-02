import type {
  ImpactCatalogItem,
  ImpactIndicatorTileFormat,
  ProjectImpactStoryChartDataKind,
  ProjectImpactStoryChartDatum,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryChartType,
  ProjectImpactStoryHeadlineKpi,
} from "../../shared/contracts.js";
import type {
  ProjectImpactStoryChartAuthoringChartCandidate,
  ProjectImpactStoryChartAuthoringComponentCandidate,
  ProjectImpactStoryChartPlanKpiCandidate,
} from "../processing/pythonProcessingClient.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";
import {
  buildChartData,
  buildChartEntryIdSetSignature,
  buildKpi,
  buildPairedStoryDeltaLabels,
  isAllowedContextDistributionChartType,
  isAllowedPairedStoryDeltaChartType,
  PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES,
  resolveChartLabel,
  resolveContextDistributionChartType,
} from "./projectImpactStoryChartPlanExecution.js";

// Confirmed-evidence counterpart to
// projectImpactStoryChartPlanExecution.ts's collectChartDisplayLabelCandidates
// — the real category names behind a confirmed paired_categorical_shift or
// single_distribution chart. paired_delta is deliberately excluded: it has
// no `shares` at all (a single measured before/after value, not a
// categorical breakdown), so there's nothing here for it to contribute.
export function collectConfirmedChartDisplayLabelCandidates(
  impactCatalog: ImpactCatalogItem[],
): string[] {
  const candidates: string[] = [];
  for (const entry of impactCatalog) {
    if (entry.shape === "single_distribution") {
      for (const share of entry.shares) {
        candidates.push(share.labelDe);
      }
    } else if (entry.shape === "paired_categorical_shift") {
      for (const share of entry.beforeShares) {
        candidates.push(share.labelDe);
      }
      for (const share of entry.afterShares) {
        candidates.push(share.labelDe);
      }
    }
  }
  return candidates;
}

// Resolves a `"{prefix}: {share.labelDe}"` compound bar label — the shape
// buildConfirmedSingleEntryChartData/buildTwoEntryDistributionComparisonChartData
// render for a before/after or two-source share — shortening only the
// share half via DisplayLabelService while keeping the prefix (a static
// "Vorher"/"Nachher", or a question/pair label — see entryLabel below)
// untouched.
function resolvePrefixedShareLabel(
  prefix: string,
  share: { labelDe: string },
  displayLabelsByRawText: Map<string, string>,
): Pick<ProjectImpactStoryChartDatum, "label" | "rawLabel"> {
  const resolved = resolveChartLabel(share.labelDe, displayLabelsByRawText);
  return resolved.rawLabel
    ? {
        label: `${prefix}: ${resolved.label}`,
        rawLabel: `${prefix}: ${resolved.rawLabel}`,
      }
    : { label: `${prefix}: ${resolved.label}` };
}

// Successor to projectImpactStoryChartPlanExecution.ts's old
// executeProjectImpactStoryChartPlan (2026-08-30, since deleted once this
// path was confirmed working end-to-end) — deterministic validation +
// execution of Python's chart *authoring* proposal, the same "Python
// plans, backend executes, never trust an LLM's own number" split,
// generalized to a merged catalog that includes confirmed impact-catalog
// evidence alongside the grounded-but-unconfirmed kinds the old function
// already handled. Reuses projectImpactStoryChartPlanExecution.ts's
// shared helpers directly wherever the underlying logic is unchanged
// (asComparableCalculationKpis, buildChartData, the
// context_distribution/paired_story_delta chart-type gates) rather than
// duplicating them — only the genuinely new surface (confirmed shapes,
// shareFilter, the mandatory-inclusion guarantee) is new code here. This
// is the only chart-plan execution path in the live request path now —
// see projectImpactStoryService.ts's planChartsAndKpis.

export interface ProjectImpactStoryChartAuthoringExecutionResult {
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  droppedKpiCount: number;
  droppedChartCount: number;
  selectedEntryIds: string[];
}

type ChartAuthoringEntry = ProjectImpactStoryCatalogEntry | ImpactCatalogItem;

function isConfirmedEntry(
  entry: ChartAuthoringEntry,
): entry is ImpactCatalogItem {
  return "shape" in entry;
}

function isChartAuthoringConfirmedEntry(
  entry: ImpactCatalogItem,
): entry is Extract<
  ImpactCatalogItem,
  { shape: "paired_categorical_shift" | "single_distribution" }
> {
  return (
    entry.shape === "paired_categorical_shift" ||
    entry.shape === "single_distribution"
  );
}

function resolveMergedEntries(
  entryIds: string[],
  entriesById: Map<string, ChartAuthoringEntry>,
): ChartAuthoringEntry[] | null {
  const resolved: ChartAuthoringEntry[] = [];
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

// A component's shareFilter, applied in the entry's own canonical order
// (never the order the model listed labels in — that would let a
// reordering imply a false trend) and rejected outright — falling back to
// "all shares" — if it would keep less than half of the entry's total
// count mass. That guards against a filter making a minority segment look
// proportionally larger than it is by hiding the majority. Matched by
// normalized (trim/lowercase/collapsed-whitespace) label, the same
// convention outcomeEvidenceApprovalSafetyCheck.ts already uses for
// answer-domain comparison.
const MIN_SHARE_FILTER_KEPT_MASS_FRACTION = 0.5;

function normalizeShareLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function applyShareFilter<T extends { labelDe: string; count: number }>(
  shares: T[],
  shareFilter: string[] | null | undefined,
): T[] {
  if (!shareFilter || shareFilter.length === 0) {
    return shares;
  }
  const normalizedFilter = new Set(shareFilter.map(normalizeShareLabel));
  const kept = shares.filter((share) =>
    normalizedFilter.has(normalizeShareLabel(share.labelDe)),
  );
  if (kept.length === 0) {
    return shares;
  }
  const totalMass = shares.reduce((sum, share) => sum + share.count, 0);
  const keptMass = kept.reduce((sum, share) => sum + share.count, 0);
  const keptFraction = totalMass > 0 ? keptMass / totalMass : 1;
  return keptFraction >= MIN_SHARE_FILTER_KEPT_MASS_FRACTION ? kept : shares;
}

// The same filter/mass-guard, applied identically to a paired shift's
// before AND after share sets — a category shown on one side but hidden
// on the other would silently misrepresent the shift, so the decision to
// keep or reject the filter is made once, from their combined mass, and
// applied to both sides together.
function applyPairedShareFilter(
  beforeShares: { labelDe: string; count: number }[],
  afterShares: { labelDe: string; count: number }[],
  shareFilter: string[] | null | undefined,
): {
  beforeShares: { labelDe: string; count: number }[];
  afterShares: { labelDe: string; count: number }[];
} {
  if (!shareFilter || shareFilter.length === 0) {
    return { beforeShares, afterShares };
  }
  const normalizedFilter = new Set(shareFilter.map(normalizeShareLabel));
  const keptBefore = beforeShares.filter((share) =>
    normalizedFilter.has(normalizeShareLabel(share.labelDe)),
  );
  const keptAfter = afterShares.filter((share) =>
    normalizedFilter.has(normalizeShareLabel(share.labelDe)),
  );
  if (keptBefore.length === 0 && keptAfter.length === 0) {
    return { beforeShares, afterShares };
  }
  const totalMass = [...beforeShares, ...afterShares].reduce(
    (sum, share) => sum + share.count,
    0,
  );
  const keptMass = [...keptBefore, ...keptAfter].reduce(
    (sum, share) => sum + share.count,
    0,
  );
  const keptFraction = totalMass > 0 ? keptMass / totalMass : 1;
  return keptFraction >= MIN_SHARE_FILTER_KEPT_MASS_FRACTION
    ? { beforeShares: keptBefore, afterShares: keptAfter }
    : { beforeShares, afterShares };
}

// paired_delta is deliberately not a valid input shape here — it's
// handled entirely by the deterministic
// projectImpactStoryConfirmedPairedDeltaCharts.ts instead (2026-08-30),
// never sent into chart authoring, so this function only ever needs to
// build the two remaining confirmed shapes.
function buildConfirmedSingleEntryChartData(
  entry: Extract<
    ImpactCatalogItem,
    { shape: "paired_categorical_shift" | "single_distribution" }
  >,
  component: ProjectImpactStoryChartAuthoringComponentCandidate,
  language: "de" | "en",
  displayLabelsByRawText: Map<string, string>,
): {
  data: ProjectImpactStoryChartDatum[];
  dataKind: ProjectImpactStoryChartDataKind;
  valueFormat: ImpactIndicatorTileFormat;
} | null {
  const { beforeLabel, afterLabel } = buildPairedStoryDeltaLabels(language);

  if (entry.shape === "paired_categorical_shift") {
    const filtered = applyPairedShareFilter(
      entry.beforeShares,
      entry.afterShares,
      component.shareFilter,
    );
    return {
      dataKind: "category",
      valueFormat: "number",
      data: [
        ...filtered.beforeShares.map((share) => ({
          ...resolvePrefixedShareLabel(
            beforeLabel,
            share,
            displayLabelsByRawText,
          ),
          value: share.count,
          group: "before" as const,
        })),
        ...filtered.afterShares.map((share) => ({
          ...resolvePrefixedShareLabel(
            afterLabel,
            share,
            displayLabelsByRawText,
          ),
          value: share.count,
          group: "after" as const,
        })),
      ],
    };
  }

  // single_distribution
  const filteredShares = applyShareFilter(entry.shares, component.shareFilter);
  if (filteredShares.length === 0) {
    return null;
  }
  return {
    dataKind: "category",
    valueFormat: "number",
    data: filteredShares.map((share) => ({
      ...resolveChartLabel(share.labelDe, displayLabelsByRawText),
      value: share.count,
    })),
  };
}

// Two entries of the same share-bearing kind, shown side by side — e.g.
// the same question asked of two different groups. Rendered as an
// "activity"-style comparison (same measure repeated across a different
// context, ranked/colored like any other cross-activity comparison — see
// buildChartData's own entries.length > 1 branch) rather than a
// before/after "comparison" chart, since there is no before/after
// relationship between two independent snapshots — this sidesteps the
// grey/blue two-series color semantic entirely rather than misusing it.
// shareFilter on either individual component is intentionally not applied
// here — combining two independent filters across two sources safely is
// out of scope for this change; a component-level shareFilter is only
// honored on a single-entry chart (see callers above).
function buildTwoEntryDistributionComparisonChartData(
  first: { labelDe: string; count: number }[],
  firstLabel: string,
  second: { labelDe: string; count: number }[],
  secondLabel: string,
  displayLabelsByRawText: Map<string, string>,
): {
  data: ProjectImpactStoryChartDatum[];
  dataKind: ProjectImpactStoryChartDataKind;
  valueFormat: ImpactIndicatorTileFormat;
} | null {
  const data = [
    ...first.map((share) => ({
      ...resolvePrefixedShareLabel(firstLabel, share, displayLabelsByRawText),
      value: share.count,
    })),
    ...second.map((share) => ({
      ...resolvePrefixedShareLabel(secondLabel, share, displayLabelsByRawText),
      value: share.count,
    })),
  ];
  return data.length > 0
    ? { dataKind: "activity", valueFormat: "number", data }
    : null;
}

// Structurally comparable = same real category set after normalization
// (identical, or one a subset of the other) — the same domain-identity
// convention IMPACT_STORY_NARRATIVE_IMPROVEMENT_PLAN.md §1b established
// for confirming a paired_categorical_shift in the first place, reused
// here for the unrelated question of whether two *different* entries may
// share one chart.
function haveComparableShareLabelSets(
  first: { labelDe: string }[],
  second: { labelDe: string }[],
): boolean {
  const firstLabels = new Set(
    first.map((share) => normalizeShareLabel(share.labelDe)),
  );
  const secondLabels = new Set(
    second.map((share) => normalizeShareLabel(share.labelDe)),
  );
  if (firstLabels.size === 0 || secondLabels.size === 0) {
    return false;
  }
  const [smaller, larger] =
    firstLabels.size <= secondLabels.size
      ? [firstLabels, secondLabels]
      : [secondLabels, firstLabels];
  for (const label of smaller) {
    if (!larger.has(label)) {
      return false;
    }
  }
  return true;
}

// Same reasoning as isAllowedPairedStoryDeltaChartType/
// isAllowedContextDistributionChartType in the reused chart-plan
// execution module: a before/after shift (paired_categorical_shift) only
// ever reads correctly as two-or-more side-by-side bars, never a pie (no
// whole to be part of) or a line (not real period data). paired_delta has
// no case here — see buildConfirmedSingleEntryChartData's own comment. A
// single distribution, or two combined, is a real categorical breakdown
// and may reasonably render as any of pie/distribution/bar — there's no
// cheap structural signal here (unlike context_distribution's precomputed
// eligibleChartTypes) to force pie only when the data structurally
// qualifies, so this trusts the model's chart-type judgment within that
// allowed set rather than overriding it.
function isAllowedConfirmedChartType(
  shape:
    | "paired_categorical_shift"
    | "single_distribution"
    | "single_distribution_comparison",
  chartType: ProjectImpactStoryChartType,
): boolean {
  if (shape === "paired_categorical_shift") {
    return chartType === "comparison" || chartType === "bar";
  }
  if (shape === "single_distribution") {
    return (
      chartType === "pie" || chartType === "distribution" || chartType === "bar"
    );
  }
  // single_distribution_comparison — two entries combined into one
  // "activity"-style comparison (see buildTwoEntryDistributionComparisonChartData).
  return chartType === "distribution" || chartType === "bar";
}

function entryShares(
  entry: ChartAuthoringEntry,
): { labelDe: string; count: number }[] | null {
  if (isConfirmedEntry(entry)) {
    return entry.shape === "single_distribution" ? entry.shares : null;
  }
  return entry.kind === "context_distribution" ? entry.shares : null;
}

// Only ever called with a measured confirmed entry (all three call sites
// resolve to this before reaching here, never "unmeasured") — narrowed to
// match, unlike entryShares above which genuinely does need to handle both
// confirmed and grounded entries.
function entryLabel(
  entry: Extract<
    ImpactCatalogItem,
    {
      shape:
        "paired_delta" | "paired_categorical_shift" | "single_distribution";
    }
  >,
): string {
  return entry.shape === "single_distribution"
    ? entry.questionLabelDe
    : entry.pairLabelDe;
}

function buildAuthoredChart(
  candidate: ProjectImpactStoryChartAuthoringChartCandidate,
  entriesById: Map<string, ChartAuthoringEntry>,
  groundedEntriesById: Map<string, ProjectImpactStoryCatalogEntry>,
  language: "de" | "en",
  hasGoalProgressChart: boolean,
  displayLabelsByRawText: Map<string, string>,
): ProjectImpactStoryChartSpec | null {
  if (
    !PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES.includes(
      candidate.chartType as ProjectImpactStoryChartType,
    )
  ) {
    return null;
  }

  const componentEntryIds = candidate.components.map(
    (component) => component.entryId,
  );
  const entries = resolveMergedEntries(componentEntryIds, entriesById);
  if (!entries || entries.length === 0) {
    return null;
  }

  const confirmedCount = entries.filter(isConfirmedEntry).length;
  const isMixedTrust = confirmedCount > 0 && confirmedCount < entries.length;
  if (isMixedTrust) {
    // Hard rule (2026-08-30): confirmed, human-vetted evidence must never
    // share a chart with evidence no human has confirmed — the visual
    // distinction between the two trust tiers must never be defeated by a
    // chart that blends them into what looks like one homogeneous group.
    return null;
  }

  const allConfirmed = confirmedCount === entries.length;

  if (!allConfirmed) {
    // Every entry is a grounded-catalog kind Python already handled before
    // this change — delegate straight to the unchanged, already-tested
    // execution logic rather than re-deriving it.
    const groundedEntries = entries as ProjectImpactStoryCatalogEntry[];

    if (
      groundedEntries.length === 1 &&
      groundedEntries[0]!.kind === "context_distribution" &&
      !isAllowedContextDistributionChartType(
        groundedEntries[0]!,
        candidate.chartType as ProjectImpactStoryChartType,
      )
    ) {
      return null;
    }
    const isExploratory =
      groundedEntries.length === 1 &&
      groundedEntries[0]!.kind === "paired_story_delta";
    if (
      isExploratory &&
      !isAllowedPairedStoryDeltaChartType(
        candidate.chartType as ProjectImpactStoryChartType,
      )
    ) {
      return null;
    }

    const built = buildChartData(
      groundedEntries,
      language,
      hasGoalProgressChart,
      displayLabelsByRawText,
    );
    if (!built || built.data.length === 0) {
      return null;
    }
    const resolvedChartType =
      groundedEntries.length === 1 &&
      groundedEntries[0]!.kind === "context_distribution"
        ? resolveContextDistributionChartType(
            groundedEntries[0]!,
            candidate.chartType as ProjectImpactStoryChartType,
          )
        : (candidate.chartType as ProjectImpactStoryChartType);

    return {
      chartId: candidate.chartId,
      chartType: resolvedChartType,
      dataKind: built.dataKind,
      valueFormat: built.valueFormat,
      title: candidate.title,
      subtitle: candidate.subtitle ?? null,
      narrativeReason: candidate.narrativeReason,
      data: built.data,
      ...(isExploratory ? { isExploratory: true } : {}),
    };
  }

  // Every entry is confirmed. Single entry: build its own shape directly.
  if (entries.length === 1) {
    const candidateEntry = entries[0] as ImpactCatalogItem;
    // Defense in depth: entriesById's confirmed half is already built
    // exclusively from isChartAuthoringConfirmedEntry-passing entries (see
    // executeProjectImpactStoryChartAuthoring below) — a paired_delta or
    // unmeasured entry should never reach this point — but never trust
    // that invariant alone against a malformed chart-authoring proposal.
    if (!isChartAuthoringConfirmedEntry(candidateEntry)) {
      return null;
    }
    const entry = candidateEntry;
    if (
      !isAllowedConfirmedChartType(
        entry.shape,
        candidate.chartType as ProjectImpactStoryChartType,
      )
    ) {
      return null;
    }
    const built = buildConfirmedSingleEntryChartData(
      entry,
      candidate.components[0]!,
      language,
      displayLabelsByRawText,
    );
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
      isConfirmedEvidence: true,
    };
  }

  // Exactly two confirmed entries: only single_distribution+single_distribution
  // may combine, and only when their real category sets are comparable.
  if (entries.length === 2) {
    const [firstEntry, secondEntry] = entries as [
      ImpactCatalogItem,
      ImpactCatalogItem,
    ];
    const firstShares = entryShares(firstEntry);
    const secondShares = entryShares(secondEntry);
    if (
      firstEntry.shape !== "single_distribution" ||
      secondEntry.shape !== "single_distribution" ||
      !firstShares ||
      !secondShares ||
      !haveComparableShareLabelSets(firstShares, secondShares) ||
      !isAllowedConfirmedChartType(
        "single_distribution_comparison",
        candidate.chartType as ProjectImpactStoryChartType,
      )
    ) {
      return null;
    }
    const built = buildTwoEntryDistributionComparisonChartData(
      firstShares,
      entryLabel(firstEntry),
      secondShares,
      entryLabel(secondEntry),
      displayLabelsByRawText,
    );
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
      isConfirmedEvidence: true,
    };
  }

  // More than two confirmed entries in one chart is never allowed — every
  // confirmed shape either stands alone or pairs with exactly one other
  // comparable single_distribution.
  return null;
}

// Synthesizes a single-entry chart deterministically for a confirmed entry
// no accepted chart ended up covering — the same mechanism
// projectImpactStoryChartBacklog.ts already uses for an unpicked grounded
// entry. This is the guarantee that a human-confirmed measurement can
// never silently disappear from the dashboard because of an LLM judgment
// call (2026-08-30 product decision). paired_delta never reaches this
// function — its own guarantee comes entirely from
// projectImpactStoryConfirmedPairedDeltaCharts.ts, called separately and
// unconditionally, not from this LLM-adjacent mandatory-inclusion pass.
function buildMandatoryInclusionChart(
  entry: Extract<
    ImpactCatalogItem,
    { shape: "paired_categorical_shift" | "single_distribution" }
  >,
  language: "de" | "en",
  displayLabelsByRawText: Map<string, string>,
): ProjectImpactStoryChartSpec | null {
  const built = buildConfirmedSingleEntryChartData(
    entry,
    { entryId: entry.entryId, shareFilter: null },
    language,
    displayLabelsByRawText,
  );
  if (!built || built.data.length === 0) {
    return null;
  }
  const chartType: ProjectImpactStoryChartType =
    entry.shape === "single_distribution" ? "distribution" : "comparison";
  return {
    chartId: `mandatory-inclusion:${entry.entryId}`,
    chartType,
    dataKind: built.dataKind,
    valueFormat: built.valueFormat,
    title: entryLabel(entry),
    subtitle: null,
    narrativeReason: entry.sourceDe,
    data: built.data,
    isConfirmedEvidence: true,
  };
}

export function executeProjectImpactStoryChartAuthoring(
  catalog: ProjectImpactStoryCatalogEntry[],
  impactCatalog: ImpactCatalogItem[],
  planResponse: {
    headlineKpis: ProjectImpactStoryChartPlanKpiCandidate[];
    chartPlan: ProjectImpactStoryChartAuthoringChartCandidate[];
  },
  language: "de" | "en" = "de",
  hasGoalProgressChart = false,
  displayLabelsByRawText: Map<string, string> = new Map(),
): ProjectImpactStoryChartAuthoringExecutionResult {
  const groundedEntriesById = new Map(
    catalog.map((entry) => [entry.entryId, entry]),
  );
  const entriesById = new Map<string, ChartAuthoringEntry>([
    ...catalog.map((entry): [string, ChartAuthoringEntry] => [
      entry.entryId,
      entry,
    ]),
    ...impactCatalog
      .filter(isChartAuthoringConfirmedEntry)
      .map((entry): [string, ChartAuthoringEntry] => [entry.entryId, entry]),
  ]);
  const selectedEntryIds = new Set<string>();

  // Headline KPIs are only ever built from grounded-catalog entries — a
  // confirmed shape has no single aggregable scalar the way a calculation/
  // goal_assessment does (a paired_delta is two numbers, a distribution is
  // a set of shares), so this reuses buildKpi unchanged against the
  // grounded-only map: any KPI candidate that references a confirmed
  // entryId simply fails to resolve, the same defensive "unknown entry"
  // path buildKpi already has.
  const headlineKpis: ProjectImpactStoryHeadlineKpi[] = [];
  let droppedKpiCount = 0;
  for (const candidate of planResponse.headlineKpis) {
    const kpi = buildKpi(candidate, groundedEntriesById, language);
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
  const acceptedChartEntryIdSetSignatures = new Set<string>();
  for (const candidate of planResponse.chartPlan) {
    const componentEntryIds = candidate.components.map(
      (component) => component.entryId,
    );
    const signature = buildChartEntryIdSetSignature(componentEntryIds);
    if (acceptedChartEntryIdSetSignatures.has(signature)) {
      droppedChartCount += 1;
      continue;
    }

    const chart = buildAuthoredChart(
      candidate,
      entriesById,
      groundedEntriesById,
      language,
      hasGoalProgressChart,
      displayLabelsByRawText,
    );
    if (chart) {
      chartPlan.push(chart);
      acceptedChartEntryIdSetSignatures.add(signature);
      for (const entryId of componentEntryIds) {
        selectedEntryIds.add(entryId);
      }
    } else {
      droppedChartCount += 1;
    }
  }

  // Mandatory-inclusion pass: every confirmed entry the LLM's proposed
  // chart set didn't end up covering gets a deterministic chart of its
  // own, appended — never silently dropped. paired_delta is excluded here
  // too — projectImpactStoryConfirmedPairedDeltaCharts.ts guarantees it by
  // an entirely separate, unconditional mechanism (see that file).
  for (const entry of impactCatalog) {
    if (
      entry.shape === "unmeasured" ||
      entry.shape === "paired_delta" ||
      selectedEntryIds.has(entry.entryId)
    ) {
      continue;
    }
    const chart = buildMandatoryInclusionChart(
      entry,
      language,
      displayLabelsByRawText,
    );
    if (chart) {
      chartPlan.push(chart);
      selectedEntryIds.add(entry.entryId);
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

// Exported for tests only.
export const __testing = {
  applyShareFilter,
  applyPairedShareFilter,
  haveComparableShareLabelSets,
};
