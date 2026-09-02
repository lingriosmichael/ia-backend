import type { ProjectImpactStoryGoalProgressEntry } from "../../shared/contracts.js";
import { computeGoalStatus } from "./projectImpactStoryChartPlanExecution.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Direction-corrects the raw measured/target ratio the same way
// computeGoalStatus does: an at_most (ceiling) goal is "on target" the
// closer measuredValue stays at or under targetValue, so its progress
// reads as targetValue/measuredValue rather than the inverse. Every other
// comparison reads as measuredValue/targetValue. Division by zero is the
// caller's job to guard against — see buildProjectImpactStoryGoalProgressEntries.
function computeGoalProgressPercent(
  measuredValue: number,
  targetValue: number,
  comparison: "at_least" | "at_most" | "equal" | null,
): number {
  const ratio =
    comparison === "at_most"
      ? targetValue / measuredValue
      : measuredValue / targetValue;
  return Math.round(ratio * 100);
}

// Deterministic, always-computed counterpart to the LLM-selected chart
// plan: one ranked-progress entry per goal_assessment catalog entry that
// has everything needed to place it on a "% of target reached" bar. Never
// subject to chart-plan selection — projectImpactStoryPage.tsx renders
// this whenever it's non-empty, the same way it already always renders the
// paired-delta group chart from impactCatalog.
export function buildProjectImpactStoryGoalProgressEntries(
  catalog: ProjectImpactStoryCatalogEntry[],
  goalDisplayLabelsByGoalText: Map<string, string> = new Map(),
): ProjectImpactStoryGoalProgressEntry[] {
  const entries: ProjectImpactStoryGoalProgressEntry[] = [];

  for (const entry of catalog) {
    if (entry.kind !== "goal_assessment") {
      continue;
    }
    if (
      entry.measuredValue === null ||
      entry.targetValue === null ||
      entry.targetValue === 0 ||
      entry.achieved === null
    ) {
      continue;
    }
    // An at_most goal with measuredValue 0 (e.g. zero dropouts against a
    // "no more than X" ceiling) has no meaningful ratio to compute — skip
    // rather than divide by zero.
    if (entry.comparison === "at_most" && entry.measuredValue === 0) {
      continue;
    }

    const status = computeGoalStatus(
      entry.achieved,
      entry.measuredValue,
      entry.targetValue,
      entry.comparison,
    );
    if (status === null) {
      continue;
    }

    entries.push({
      entryId: entry.entryId,
      label: entry.goalText,
      displayLabel:
        goalDisplayLabelsByGoalText.get(entry.goalText) ?? entry.goalText,
      activityName: entry.activityName,
      progressPercent: computeGoalProgressPercent(
        entry.measuredValue,
        entry.targetValue,
        entry.comparison,
      ),
      status,
    });
  }

  return entries;
}
