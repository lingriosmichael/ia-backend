import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectImpactStoryNarrativeOutputFacts } from "./projectImpactStoryNarrativeOutputFacts.js";
import {
  buildCalculation,
  buildGoalAssessment,
  buildRun,
  buildUpload,
} from "./projectImpactStoryTestFixtures.js";

test("builds deterministic output facts from grounded goal-linked KPI calculations", () => {
  const kpiCalculation = buildCalculation("calc-reached", {
    toolName: "count_rows",
    label: "Jugendliche erreicht",
    description: "Anzahl der Jugendlichen mit Teilnahme.",
    value: 127,
    unit: "rows",
  });
  const nonKpiCalculation = buildCalculation("calc-groups", {
    toolName: "group_count",
    result: { groups: [{ value: "Nord", count: 5 }] },
  });

  const run = buildRun(
    "run-1",
    "activity-1",
    [kpiCalculation, nonKpiCalculation],
    [
      buildGoalAssessment(["calc-reached", "calc-groups"], {
        goalId: "goal-1",
        goalText: "Mindestens 120 Jugendliche erreichen",
        assessmentStatus: "achieved",
      }),
    ],
  );

  const outputFacts = buildProjectImpactStoryNarrativeOutputFacts(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
    "de",
  );

  assert.equal(outputFacts.length, 1);
  assert.equal(
    outputFacts[0]?.entryId,
    "activity-1:output_fact:goal-1:calc-reached",
  );
  assert.equal(outputFacts[0]?.goalId, "goal-1");
  assert.equal(
    outputFacts[0]?.goalText,
    "Mindestens 120 Jugendliche erreichen",
  );
  assert.equal(outputFacts[0]?.value, 127);
  assert.equal(outputFacts[0]?.formatAs, "number");
  assert.match(outputFacts[0]?.label ?? "", /Eintr|erreicht/i);
});

test("excludes calculations for goals that are still ungrounded", () => {
  const groundedCalculation = buildCalculation("calc-grounded", { value: 42 });
  const ungroundedCalculation = buildCalculation("calc-ungrounded", {
    value: 7,
  });

  const run = buildRun(
    "run-1",
    "activity-1",
    [groundedCalculation, ungroundedCalculation],
    [
      buildGoalAssessment(["calc-grounded"], {
        goalId: "goal-achieved",
        goalText: "65 Mentor:innen schulen",
        assessmentStatus: "achieved",
      }),
      buildGoalAssessment(["calc-ungrounded"], {
        goalId: "goal-blocked",
        goalText: "80 % Teilnahmequote sichern",
        assessmentStatus: "requires_clarification",
      }),
    ],
  );

  const outputFacts = buildProjectImpactStoryNarrativeOutputFacts(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
    "de",
  );

  assert.equal(outputFacts.length, 1);
  assert.equal(outputFacts[0]?.goalId, "goal-achieved");
  assert.equal(outputFacts[0]?.value, 42);
});
