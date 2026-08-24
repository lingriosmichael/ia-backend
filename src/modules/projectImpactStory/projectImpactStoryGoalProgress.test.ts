import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectImpactStoryGoalProgressEntries } from "./projectImpactStoryGoalProgress.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

function goalAssessmentEntry(
  overrides: Partial<
    Extract<ProjectImpactStoryCatalogEntry, { kind: "goal_assessment" }>
  > &
    Pick<
      Extract<ProjectImpactStoryCatalogEntry, { kind: "goal_assessment" }>,
      "entryId" | "activityId" | "assessmentStatus"
    >,
): Extract<ProjectImpactStoryCatalogEntry, { kind: "goal_assessment" }> {
  return {
    kind: "goal_assessment",
    activityName: overrides.activityId,
    goalType: "output",
    goalText: "Reach youth",
    achieved: null,
    measuredValue: null,
    targetValue: null,
    comparison: null,
    ...overrides,
  };
}

test("an achieved at_least goal becomes a 'good' progress entry over 100%", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "e1",
      activityId: "act-1",
      assessmentStatus: "achieved",
      achieved: true,
      measuredValue: 107,
      targetValue: 100,
      comparison: "at_least",
    }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.status, "good");
  assert.equal(entries[0]!.progressPercent, 107);
});

test("a not-achieved at_least goal close to target becomes 'warn'", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "e1",
      activityId: "act-1",
      assessmentStatus: "mixed_evidence",
      achieved: false,
      measuredValue: 87,
      targetValue: 100,
      comparison: "at_least",
    }),
  ]);

  assert.equal(entries[0]!.status, "warn");
  assert.equal(entries[0]!.progressPercent, 87);
});

test("a not-achieved at_least goal far below target becomes 'risk'", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "e1",
      activityId: "act-1",
      assessmentStatus: "not_achieved",
      achieved: false,
      measuredValue: 6,
      targetValue: 10,
      comparison: "at_least",
    }),
  ]);

  assert.equal(entries[0]!.status, "risk");
  assert.equal(entries[0]!.progressPercent, 60);
});

test("an at_most (ceiling) goal's progress is direction-corrected, not a raw ratio", () => {
  // Ceiling of 5 allowed dropouts, only 2 measured — well within budget, so
  // progress should read as comfortably over 100%, not 40%.
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "e1",
      activityId: "act-1",
      assessmentStatus: "achieved",
      achieved: true,
      measuredValue: 2,
      targetValue: 5,
      comparison: "at_most",
    }),
  ]);

  assert.equal(entries[0]!.status, "good");
  assert.equal(entries[0]!.progressPercent, 250);
});

test("an at_most goal with a zero measured value is skipped rather than dividing by zero", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "e1",
      activityId: "act-1",
      assessmentStatus: "achieved",
      achieved: true,
      measuredValue: 0,
      targetValue: 5,
      comparison: "at_most",
    }),
  ]);

  assert.equal(entries.length, 0);
});

test("a goal missing measuredValue, targetValue, or achieved is dropped rather than defaulted", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    goalAssessmentEntry({
      entryId: "no-measured",
      activityId: "act-1",
      assessmentStatus: "requires_clarification",
      achieved: null,
      measuredValue: null,
      targetValue: 100,
      comparison: "at_least",
    }),
    goalAssessmentEntry({
      entryId: "no-target",
      activityId: "act-1",
      assessmentStatus: "requires_clarification",
      achieved: null,
      measuredValue: 50,
      targetValue: null,
      comparison: "at_least",
    }),
    goalAssessmentEntry({
      entryId: "no-achieved",
      activityId: "act-1",
      assessmentStatus: "requires_clarification",
      achieved: null,
      measuredValue: 50,
      targetValue: 100,
      comparison: "at_least",
    }),
    goalAssessmentEntry({
      entryId: "zero-target",
      activityId: "act-1",
      assessmentStatus: "requires_clarification",
      achieved: true,
      measuredValue: 50,
      targetValue: 0,
      comparison: "at_least",
    }),
  ]);

  assert.equal(entries.length, 0);
});

test("non-goal_assessment catalog entries are ignored", () => {
  const entries = buildProjectImpactStoryGoalProgressEntries([
    {
      kind: "calculation",
      entryId: "calc-1",
      activityId: "act-1",
      activityName: "act-1",
      toolName: "count_rows",
      unit: "rows",
      denominatorType: null,
      tile: {
        kind: "kpi",
        indicatorId: "calc-1",
        label: "Participants reached",
        description: "",
        value: 100,
        formatAs: "number",
      },
    },
  ]);

  assert.equal(entries.length, 0);
});
