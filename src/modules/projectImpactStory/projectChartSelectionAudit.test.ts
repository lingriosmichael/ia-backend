import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectChartOpportunityAuditEntry } from "../../shared/contracts.js";
import { buildProjectChartSelectionAudit } from "./projectChartSelectionAudit.js";

function buildOpportunityEntry(
  overrides: Partial<ProjectChartOpportunityAuditEntry> = {},
): ProjectChartOpportunityAuditEntry {
  return {
    entryId: "activity-1:calc:calc-1",
    kind: "calculation",
    activityId: "activity-1",
    activityName: "Workshop A",
    title: "Personen erreicht",
    sourceTables: [],
    status: "ready_now",
    reasonCode: "grounded_calculation",
    reasonDetail: "Already materialized.",
    ...overrides,
  };
}

test("a ready entry that was selected appears in selectedEntryIds, not unselectedReadyEntryIds", () => {
  const opportunityAudit = [buildOpportunityEntry()];

  const audit = buildProjectChartSelectionAudit(opportunityAudit, [
    "activity-1:calc:calc-1",
  ]);

  assert.deepEqual(audit.selectedEntryIds, ["activity-1:calc:calc-1"]);
  assert.deepEqual(audit.unselectedReadyEntryIds, []);
  assert.deepEqual(audit.highSignalUnselectedEntryIds, []);
  assert.deepEqual(audit.selectionWarnings, []);
});

test("a ready calculation that was not selected is high-signal unselected with a warning", () => {
  const opportunityAudit = [
    buildOpportunityEntry({
      entryId: "activity-1:context:survey.bezirk",
      kind: "context_distribution",
      title: "Verteilung: Bezirk",
    }),
  ];

  const audit = buildProjectChartSelectionAudit(opportunityAudit, []);

  assert.deepEqual(audit.unselectedReadyEntryIds, [
    "activity-1:context:survey.bezirk",
  ]);
  assert.deepEqual(audit.highSignalUnselectedEntryIds, [
    "activity-1:context:survey.bezirk",
  ]);
  assert.equal(audit.selectionWarnings.length, 1);
  assert.match(audit.selectionWarnings[0] ?? "", /Verteilung: Bezirk/);
});

test("an unselected ready goal_assessment is unselected but not high-signal", () => {
  const opportunityAudit = [
    buildOpportunityEntry({
      entryId: "activity-1:goal:goal-1",
      kind: "goal_assessment",
    }),
  ];

  const audit = buildProjectChartSelectionAudit(opportunityAudit, []);

  assert.deepEqual(audit.unselectedReadyEntryIds, ["activity-1:goal:goal-1"]);
  assert.deepEqual(audit.highSignalUnselectedEntryIds, []);
  assert.deepEqual(audit.selectionWarnings, []);
});

test("a blocked (not ready_now) entry never appears in unselectedReadyEntryIds", () => {
  const opportunityAudit = [
    buildOpportunityEntry({ status: "blocked_by_extraction" }),
  ];

  const audit = buildProjectChartSelectionAudit(opportunityAudit, []);

  assert.deepEqual(audit.unselectedReadyEntryIds, []);
});
