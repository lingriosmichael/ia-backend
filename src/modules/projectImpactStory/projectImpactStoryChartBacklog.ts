import type { ProjectImpactStoryChartSpec } from "../../shared/contracts.js";
import {
  buildChartData,
  resolveContextDistributionChartType,
} from "./projectImpactStoryChartPlanExecution.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Every backlog chart is prefixed so its id can never collide with an
// LLM-chosen chartId (an arbitrary string the model invents) or with a
// deterministic chart's own fixed id ("goal-progress", "paired-delta-group").
function buildBacklogChartId(entryId: string): string {
  return `backlog:${entryId}`;
}

// The deterministic, no-LLM counterpart to the chart-plan's own chart
// selection: one ready-to-render chart per catalog entry the chart plan
// *didn't* select this run, so the analytics tab's backlog panel can add
// any of them to the dashboard instantly on click — no narrative framing,
// no chart-type judgment call, just the same structural rules
// (buildChartData, resolveContextDistributionChartType) the chart plan's
// own execution already uses. Title/subtitle come straight from the
// catalog entry's own plain-language fields rather than an LLM-authored
// story, matching the tradeoff already made for this feature (instant and
// reliable over narratively polished).
//
// Only three catalog kinds ever produce a real backlog chart:
// - context_distribution and paired_story_delta already have a
//   single-entry branch in buildChartData.
// - calculation only when its tile is category_rank or line_series — a
//   plain scalar KPI tile has no chart shape to offer (it's a single
//   number, not a distribution or series).
// goal_assessment entries are deliberately never offered here: an
// individual goal already lives in the deterministic goal-progress chart
// (see projectImpactStoryGoalProgress.ts) when that chart exists, and
// reads better as a headline KPI than a standalone one-segment chart when
// it doesn't — the same reasoning that already excludes goal_assessment
// groupings from the chart-plan when the goal-progress chart covers them.
export function buildProjectImpactStoryChartBacklog(
  catalog: ProjectImpactStoryCatalogEntry[],
  selectedEntryIds: ReadonlySet<string>,
  language: "de" | "en",
  displayLabelsByRawText: Map<string, string> = new Map(),
): ProjectImpactStoryChartSpec[] {
  const charts: ProjectImpactStoryChartSpec[] = [];

  for (const entry of catalog) {
    if (selectedEntryIds.has(entry.entryId)) {
      continue;
    }

    if (entry.kind === "context_distribution") {
      const built = buildChartData(
        [entry],
        language,
        false,
        displayLabelsByRawText,
      );
      if (!built || built.data.length === 0) {
        continue;
      }
      charts.push({
        chartId: buildBacklogChartId(entry.entryId),
        chartType: resolveContextDistributionChartType(entry, "distribution"),
        dataKind: built.dataKind,
        valueFormat: built.valueFormat,
        title: entry.labelDe,
        subtitle: entry.dimensionLabelDe,
        narrativeReason: entry.sourceDe,
        data: built.data,
      });
      continue;
    }

    if (entry.kind === "paired_story_delta") {
      const built = buildChartData(
        [entry],
        language,
        false,
        displayLabelsByRawText,
      );
      if (!built || built.data.length === 0) {
        continue;
      }
      charts.push({
        chartId: buildBacklogChartId(entry.entryId),
        chartType: "comparison",
        dataKind: built.dataKind,
        valueFormat: built.valueFormat,
        title: entry.pairLabelDe,
        subtitle: null,
        narrativeReason: entry.sourceDe,
        data: built.data,
        isExploratory: true,
      });
      continue;
    }

    if (entry.kind === "calculation") {
      if (
        entry.tile.kind !== "category_rank" &&
        entry.tile.kind !== "line_series"
      ) {
        continue;
      }
      const built = buildChartData(
        [entry],
        language,
        false,
        displayLabelsByRawText,
      );
      if (!built || built.data.length === 0) {
        continue;
      }
      charts.push({
        chartId: buildBacklogChartId(entry.entryId),
        chartType: entry.tile.kind === "line_series" ? "line" : "distribution",
        dataKind: built.dataKind,
        valueFormat: built.valueFormat,
        title: entry.tile.label,
        subtitle: entry.tile.description,
        narrativeReason: "",
        data: built.data,
      });
    }
  }

  return charts;
}
