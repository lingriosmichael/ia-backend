import type {
  ImpactCatalogItem,
  ProjectImpactStoryChartDatum,
  ProjectImpactStoryChartSpec,
} from "../../shared/contracts.js";
import { buildPairedStoryDeltaLabels } from "./projectImpactStoryChartPlanExecution.js";

// Deterministic, always-computed counterpart to the chart-authoring LLM
// call — same rationale and same "never subject to LLM selection" posture
// as projectImpactStoryGoalProgress.ts's buildProjectImpactStoryGoalProgressEntries.
// Confirmed paired_delta evidence (before/after outcome measurement, human-
// vetted) is excluded from the chart-authoring catalog entirely (see
// projectImpactStoryChartAuthoringRequestMapper.ts) and handled here
// instead, for one reason: showing every confirmed paired_delta together,
// with before/after separated by color, was previously an LLM-adjacent
// concern with no real structural signal (paired_delta has no toolName/
// unit the way a calculation entry does) to check whether two pairs are on
// a genuinely comparable scale before combining them. Making it fully
// deterministic sidesteps needing that signal at all — this file always
// combines every scale-direction-compatible pair into one chart, on raw
// values, and always renders it, the same guarantee goalProgressEntries
// already has.
//
// Known, accepted limitation (2026-08-30 product decision, not silently
// dropped): this still plots every included pair's raw before/after
// values on one shared axis with no check that their scales are actually
// comparable in magnitude (e.g. a 1-5 Likert pair next to a raw headcount
// pair). Revisit with an explicit per-pair scale/unit signal if this
// proves misleading in practice on a real project.

const CONFIRMED_PAIRED_DELTA_OVERVIEW_CHART_ID =
  "confirmed-paired-delta-overview";

function buildDatumPair(
  entry: Extract<ImpactCatalogItem, { shape: "paired_delta" }>,
  beforeLabel: string,
  afterLabel: string,
): ProjectImpactStoryChartDatum[] {
  return [
    {
      label: `${entry.pairLabelDe} — ${beforeLabel}`,
      value: entry.beforeValue,
      group: "before",
    },
    {
      label: `${entry.pairLabelDe} — ${afterLabel}`,
      value: entry.afterValue,
      group: "after",
    },
  ];
}

// Builds every confirmed-paired-delta chart for the dashboard: one shared
// chart grouping every pair whose scaleDirection doesn't conflict with
// being plotted "higher bar is better" (i.e. not lower_is_better, or
// direction not yet declared), plus one standalone chart per
// lower_is_better pair — reusing the exact same "excluded from the shared
// axis, never silently dropped" carve-out this feature already applied
// before the chart-authoring redesign, for the same reason: mixing a
// lower-is-better pair into a shared "higher is better" axis would
// visually misrepresent it.
export function buildProjectImpactStoryConfirmedPairedDeltaCharts(
  impactCatalog: ImpactCatalogItem[],
  language: "de" | "en",
): ProjectImpactStoryChartSpec[] {
  const pairedDeltaEntries = impactCatalog.filter(
    (entry): entry is Extract<ImpactCatalogItem, { shape: "paired_delta" }> =>
      entry.shape === "paired_delta",
  );
  if (pairedDeltaEntries.length === 0) {
    return [];
  }

  const { beforeLabel, afterLabel } = buildPairedStoryDeltaLabels(language);
  const comparable = pairedDeltaEntries.filter(
    (entry) => entry.scaleDirection !== "lower_is_better",
  );
  const reverseScored = pairedDeltaEntries.filter(
    (entry) => entry.scaleDirection === "lower_is_better",
  );

  const charts: ProjectImpactStoryChartSpec[] = [];

  if (comparable.length > 0) {
    charts.push({
      chartId: CONFIRMED_PAIRED_DELTA_OVERVIEW_CHART_ID,
      chartType: "comparison",
      dataKind: "category",
      valueFormat: "number",
      title:
        language === "de"
          ? "Bestätigte Wirkung im Überblick"
          : "Confirmed outcomes at a glance",
      subtitle: null,
      narrativeReason:
        language === "de"
          ? "Bestätigte Vorher-/Nachher-Messungen, automatisch aus Ihren Daten erzeugt."
          : "Confirmed before/after measurements, generated automatically from your data.",
      data: comparable.flatMap((entry) =>
        buildDatumPair(entry, beforeLabel, afterLabel),
      ),
      isConfirmedEvidence: true,
    });
  }

  for (const entry of reverseScored) {
    charts.push({
      chartId: `confirmed-paired-delta:${entry.entryId}`,
      chartType: "comparison",
      dataKind: "category",
      valueFormat: "number",
      title: entry.pairLabelDe,
      subtitle: null,
      narrativeReason: entry.sourceDe,
      data: buildDatumPair(entry, beforeLabel, afterLabel),
      isConfirmedEvidence: true,
    });
  }

  return charts;
}
