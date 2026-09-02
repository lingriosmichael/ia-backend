import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectImpactStoryCatalog } from "./projectImpactStoryCatalog.js";
import {
  buildCalculation,
  buildGoalAssessment,
  buildRun,
  buildUpload,
} from "./projectImpactStoryTestFixtures.js";

test("includes every goal assessment regardless of status, but only grounded calculations", () => {
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
        assessmentStatus: "achieved",
      }),
      buildGoalAssessment(["calc-ungrounded"], {
        goalId: "goal-blocked",
        assessmentStatus: "requires_clarification",
      }),
    ],
  );

  const catalog = buildProjectImpactStoryCatalog(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
    "en",
  );

  const calculationEntries = catalog.filter(
    (entry) => entry.kind === "calculation",
  );
  const goalEntries = catalog.filter(
    (entry) => entry.kind === "goal_assessment",
  );

  assert.equal(calculationEntries.length, 1);
  assert.equal(calculationEntries[0]?.entryId, "activity-1:calc:calc-grounded");

  // Both goal assessments appear, including the requires_clarification one —
  // the gap itself is real data even though its calculation is excluded.
  assert.equal(goalEntries.length, 2);
  assert.deepEqual(
    goalEntries
      .map(
        (entry) => entry.kind === "goal_assessment" && entry.assessmentStatus,
      )
      .sort(),
    ["achieved", "requires_clarification"],
  );
});

test("excludes catalog entries for an activity with no current completed run", () => {
  const run = buildRun(
    "run-1",
    "activity-1",
    [buildCalculation("calc-1", { value: 1 })],
    [buildGoalAssessment(["calc-1"])],
  );

  const catalog = buildProjectImpactStoryCatalog(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    // Uploads no longer match the run's evidence snapshot.
    [buildUpload("upload-new", "activity-1")],
    "en",
  );

  assert.deepEqual(catalog, []);
});
