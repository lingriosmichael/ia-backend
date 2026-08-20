import type {
  ProjectChartOpportunityAuditEntry,
  ProjectChartSelectionAudit,
} from "../../shared/contracts.js";

export type { ProjectChartSelectionAudit } from "../../shared/contracts.js";

// Deterministic diff between "what could the planner have shown" (the
// opportunity audit's ready_now set, computed from the exact same catalog
// this generation run sent to chart_plan.py) and "what did it actually
// show" (executeProjectImpactStoryChartPlan's selectedEntryIds, from this
// same generation run). Answers the failure mode a static opportunity
// audit alone cannot: "bezirk was available — why didn't it show up?"
// Must be computed from the same generation run's own ready_now/selected
// sets, never recomputed later against since-changed data, or the diff
// stops meaning what it claims to.
export function buildProjectChartSelectionAudit(
  opportunityAudit: ProjectChartOpportunityAuditEntry[],
  selectedEntryIds: string[],
): ProjectChartSelectionAudit {
  const selectedEntryIdSet = new Set(selectedEntryIds);
  const readyNowEntries = opportunityAudit.filter(
    (entry) => entry.status === "ready_now",
  );
  const unselectedReadyEntries = readyNowEntries.filter(
    (entry) => !selectedEntryIdSet.has(entry.entryId),
  );
  const highSignalUnselectedEntries = unselectedReadyEntries.filter(
    (entry) =>
      entry.kind === "context_distribution" || entry.kind === "calculation",
  );

  return {
    selectedEntryIds: [...selectedEntryIdSet],
    unselectedReadyEntryIds: unselectedReadyEntries.map(
      (entry) => entry.entryId,
    ),
    highSignalUnselectedEntryIds: highSignalUnselectedEntries.map(
      (entry) => entry.entryId,
    ),
    selectionWarnings: highSignalUnselectedEntries.map(
      (entry) =>
        `"${entry.title}" (${entry.activityName}) was ready but not selected into any chart or KPI.`,
    ),
  };
}
