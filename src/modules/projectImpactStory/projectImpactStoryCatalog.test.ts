import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectImpactStoryCatalog,
  toProjectImpactStoryChartPlanRequestEntries,
} from "./projectImpactStoryCatalog.js";
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

test("flattens catalog entries into the chart-plan wire shape without leaking bucket/point data", () => {
  const kpiCalculation = buildCalculation("calc-kpi", {
    toolName: "calculate_ratio",
    unit: "ratio",
    value: 0.5,
  });
  const rankCalculation = buildCalculation("calc-rank", {
    toolName: "group_count",
    unit: "groups",
    result: { groups: [{ value: "Nord", count: 5 }] },
  });

  const run = buildRun(
    "run-1",
    "activity-1",
    [kpiCalculation, rankCalculation],
    [buildGoalAssessment(["calc-kpi", "calc-rank"])],
  );

  const catalog = buildProjectImpactStoryCatalog(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
    "en",
  );

  const requestEntries = toProjectImpactStoryChartPlanRequestEntries(catalog);
  const kpiRequestEntry = requestEntries.find(
    (entry) => entry.entryId === "activity-1:calc:calc-kpi",
  );
  const rankRequestEntry = requestEntries.find(
    (entry) => entry.entryId === "activity-1:calc:calc-rank",
  );

  assert.equal(kpiRequestEntry?.value, 0.5);
  // A category_rank entry has no single scalar value — the request only
  // carries label/description/toolName/unit context, never the buckets.
  assert.equal(rankRequestEntry?.value, null);
  assert.equal((rankRequestEntry as { buckets?: unknown }).buckets, undefined);
});
