import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectImpactStoryAssembly } from "./projectImpactStoryAssembly.js";
import {
  buildCalculation,
  buildGoalAssessment,
  buildRun,
  buildUpload,
} from "./projectImpactStoryTestFixtures.js";

test("excludes calculations that support only ungrounded goal assessments", () => {
  const calculationRequiresClarification = buildCalculation("calc-1");
  const calculationRequiresCapability = buildCalculation("calc-2");
  const calculationUnreferenced = buildCalculation("calc-3");

  const run = buildRun(
    "run-1",
    "activity-1",
    [
      calculationRequiresClarification,
      calculationRequiresCapability,
      calculationUnreferenced,
    ],
    [
      buildGoalAssessment(["calc-1"], {
        goalId: "goal-1",
        assessmentStatus: "requires_clarification",
      }),
      buildGoalAssessment(["calc-2"], {
        goalId: "goal-2",
        assessmentStatus: "requires_capability",
      }),
    ],
  );

  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Mentoring-Workshops" }],
    activityAnalysisRuns: [run],
    uploads: [buildUpload("upload-activity-1", "activity-1")],
    language: "en",
  });

  assert.equal(result.activityCards.length, 0);
  assert.deepEqual(result.diagnostics.activitiesWithNoGroundedIndicators, [
    "Mentoring-Workshops",
  ]);
  assert.equal(result.diagnostics.indicatorCount, 0);
});

test("selects tile kind from the calculation tool name, not the raw unit string", () => {
  const kpiCalculation = buildCalculation("calc-kpi", {
    toolName: "count_distinct",
    unit: "distinct_values",
    value: 42,
  });
  const ratioCalculation = buildCalculation("calc-ratio", {
    toolName: "calculate_ratio",
    unit: "ratio",
    value: 0.82,
  });
  const rankCalculation = buildCalculation("calc-rank", {
    toolName: "group_count",
    unit: "groups",
    value: 3,
    result: {
      groups: [
        { value: "Süd", count: 12 },
        { value: "Nord", count: 5 },
        { value: "Ost", count: 3 },
      ],
    },
  });
  const trendCalculation = buildCalculation("calc-trend", {
    toolName: "time_bucket_count",
    unit: "buckets",
    value: 2,
    result: {
      buckets: [
        { bucket: "2026-01", count: 9 },
        { bucket: "2026-02", count: 4 },
      ],
    },
  });

  const calculations = [
    kpiCalculation,
    ratioCalculation,
    rankCalculation,
    trendCalculation,
  ];
  const run = buildRun("run-1", "activity-1", calculations, [
    buildGoalAssessment(
      calculations.map((calculation) => calculation.calculationId),
    ),
  ]);

  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Beratungsangebot" }],
    activityAnalysisRuns: [run],
    uploads: [buildUpload("upload-activity-1", "activity-1")],
    language: "en",
  });

  assert.equal(result.activityCards.length, 1);
  const card = result.activityCards[0]!;
  assert.equal(card.tiles.length, 4);

  const kpiCount = card.tiles.find((tile) => tile.indicatorId === "calc-kpi");
  assert.equal(kpiCount?.kind, "kpi");
  assert.equal(
    kpiCount && kpiCount.kind === "kpi" && kpiCount.formatAs,
    "number",
  );

  const kpiRatio = card.tiles.find((tile) => tile.indicatorId === "calc-ratio");
  assert.equal(kpiRatio?.kind, "kpi");
  assert.equal(
    kpiRatio && kpiRatio.kind === "kpi" && kpiRatio.formatAs,
    "percentage",
  );

  const rank = card.tiles.find((tile) => tile.indicatorId === "calc-rank");
  assert.equal(rank?.kind, "category_rank");
  assert.deepEqual(
    rank && rank.kind === "category_rank" ? rank.buckets : null,
    [
      { category: "Süd", count: 12 },
      { category: "Nord", count: 5 },
      { category: "Ost", count: 3 },
    ],
  );

  const trend = card.tiles.find((tile) => tile.indicatorId === "calc-trend");
  assert.equal(trend?.kind, "line_series");
  assert.deepEqual(
    trend && trend.kind === "line_series" ? trend.points : null,
    [
      {
        period: "2026-01",
        count: 9,
        numeratorCount: null,
        denominatorCount: null,
      },
      {
        period: "2026-02",
        count: 4,
        numeratorCount: null,
        denominatorCount: null,
      },
    ],
  );
});

test("excludes reusable-intermediate-result tools from KPI tiles", () => {
  const intermediateCalculation = buildCalculation("calc-intermediate", {
    toolName: "group_aggregate",
    unit: "groups",
    value: 7, // row count of the reusable intermediate table, not a metric
  });
  const run = buildRun(
    "run-1",
    "activity-1",
    [intermediateCalculation],
    [buildGoalAssessment(["calc-intermediate"])],
  );

  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Workshop A" }],
    activityAnalysisRuns: [run],
    uploads: [buildUpload("upload-activity-1", "activity-1")],
    language: "en",
  });

  assert.equal(result.activityCards.length, 0);
  assert.equal(result.diagnostics.excludedIndicatorCount, 1);
});

test("groups tiles per activity with no cross-activity summation", () => {
  const calculationA = buildCalculation("calc-a", { value: 100 });
  const calculationB = buildCalculation("calc-b", { value: 50 });

  const runA = buildRun(
    "run-a",
    "activity-1",
    [calculationA],
    [buildGoalAssessment(["calc-a"])],
  );
  const runB = buildRun(
    "run-b",
    "activity-2",
    [calculationB],
    [buildGoalAssessment(["calc-b"])],
  );

  const result = buildProjectImpactStoryAssembly({
    activities: [
      { id: "activity-1", name: "Workshop A" },
      { id: "activity-2", name: "Workshop B" },
    ],
    activityAnalysisRuns: [runA, runB],
    uploads: [
      buildUpload("upload-activity-1", "activity-1"),
      buildUpload("upload-activity-2", "activity-2"),
    ],
    language: "en",
  });

  assert.equal(result.activityCards.length, 2);
  const cardA = result.activityCards.find(
    (card) => card.activityId === "activity-1",
  );
  const cardB = result.activityCards.find(
    (card) => card.activityId === "activity-2",
  );
  assert.equal(cardA?.tiles[0]?.kind === "kpi" && cardA.tiles[0].value, 100);
  assert.equal(cardB?.tiles[0]?.kind === "kpi" && cardB.tiles[0].value, 50);
  assert.equal(
    JSON.stringify(result).includes("150"),
    false,
    "assembly must never sum values across activities",
  );
});

test("returns an empty story with full diagnostics for a project with no completed runs", () => {
  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Noch keine Auswertung" }],
    activityAnalysisRuns: [],
    uploads: [],
    language: "en",
  });

  assert.equal(result.activityCards.length, 0);
  assert.deepEqual(result.diagnostics, {
    activityCount: 1,
    indicatorCount: 0,
    excludedIndicatorCount: 0,
    activitiesWithNoGroundedIndicators: ["Noch keine Auswertung"],
  });
  assert.deepEqual(result.sourceSnapshot, []);
  assert.deepEqual(result.narrativeInput, []);
});

test("excludes a completed run whose evidence no longer matches current uploads", () => {
  const calculation = buildCalculation("calc-1", { value: 30 });
  const run = buildRun(
    "run-1",
    "activity-1",
    [calculation],
    [buildGoalAssessment(["calc-1"])],
  );

  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Workshop A" }],
    activityAnalysisRuns: [run],
    // Current uploads no longer match the run's evidence snapshot
    // (upload-activity-1) — e.g. new evidence was uploaded since this run.
    uploads: [buildUpload("upload-new", "activity-1")],
    language: "en",
  });

  assert.equal(result.activityCards.length, 0);
  assert.deepEqual(result.diagnostics.activitiesWithNoGroundedIndicators, [
    "Workshop A",
  ]);
});

test("narrativeInput only includes kpi tiles, stripped of ids", () => {
  const kpiCalculation = buildCalculation("calc-kpi", { value: 30 });
  const trendCalculation = buildCalculation("calc-trend", {
    toolName: "time_bucket_count",
    unit: "buckets",
    value: 1,
    result: { buckets: [{ bucket: "2026-01", count: 3 }] },
  });

  const run = buildRun(
    "run-1",
    "activity-1",
    [kpiCalculation, trendCalculation],
    [buildGoalAssessment(["calc-kpi", "calc-trend"])],
  );

  const result = buildProjectImpactStoryAssembly({
    activities: [{ id: "activity-1", name: "Workshop A" }],
    activityAnalysisRuns: [run],
    uploads: [buildUpload("upload-activity-1", "activity-1")],
    language: "en",
  });

  assert.deepEqual(result.narrativeInput, [
    {
      activityId: "activity-1",
      activityName: "Workshop A",
      tiles: [
        {
          label: "Entries in the uploaded data",
          description: "Total number of records counted.",
          value: 30,
          formatAs: "number",
        },
      ],
    },
  ]);
});
