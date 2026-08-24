import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectImpactStoryChartBacklog } from "./projectImpactStoryChartBacklog.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

function contextDistributionEntry(
  overrides: Partial<
    Extract<ProjectImpactStoryCatalogEntry, { kind: "context_distribution" }>
  > &
    Pick<
      Extract<ProjectImpactStoryCatalogEntry, { kind: "context_distribution" }>,
      "entryId" | "activityId"
    >,
): Extract<ProjectImpactStoryCatalogEntry, { kind: "context_distribution" }> {
  return {
    kind: "context_distribution",
    activityName: overrides.activityId,
    labelDe: "Verteilung nach Bezirk",
    dimensionLabelDe: "Bezirk",
    shares: [
      { labelDe: "Mitte", count: 18 },
      { labelDe: "Nord", count: 11 },
    ],
    n: 29,
    eligibleChartTypes: ["hbar_target", "donut_share"],
    sourceDe: "Quelle: baseline.csv / bezirk",
    ...overrides,
  };
}

function calculationEntry(
  overrides: Partial<
    Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>
  > &
    Pick<
      Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }>,
      "entryId" | "activityId"
    >,
): Extract<ProjectImpactStoryCatalogEntry, { kind: "calculation" }> {
  return {
    kind: "calculation",
    activityName: overrides.activityId,
    toolName: "count_rows",
    unit: "rows",
    denominatorType: null,
    tile: {
      kind: "kpi",
      indicatorId: overrides.entryId,
      label: "Participants reached",
      description: "",
      value: 100,
      formatAs: "number",
    },
    ...overrides,
  };
}

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

test("an unselected context_distribution entry becomes a backlog chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    contextDistributionEntry({ entryId: "ctx-1", activityId: "activity-1" }),
  ];

  const backlog = buildProjectImpactStoryChartBacklog(catalog, new Set(), "de");

  assert.equal(backlog.length, 1);
  assert.equal(backlog[0]?.chartId, "backlog:ctx-1");
  assert.equal(backlog[0]?.title, "Verteilung nach Bezirk");
  assert.deepEqual(backlog[0]?.data, [
    { label: "Mitte", value: 18 },
    { label: "Nord", value: 11 },
  ]);
});

test("an entry already selected into the chart plan is excluded from the backlog", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    contextDistributionEntry({ entryId: "ctx-1", activityId: "activity-1" }),
  ];

  const backlog = buildProjectImpactStoryChartBacklog(
    catalog,
    new Set(["ctx-1"]),
    "de",
  );

  assert.equal(backlog.length, 0);
});

test("a calculation entry with a plain scalar kpi tile is not offered as a backlog chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "calc-1", activityId: "activity-1" }),
  ];

  const backlog = buildProjectImpactStoryChartBacklog(catalog, new Set(), "de");

  assert.equal(backlog.length, 0);
});

test("a calculation entry with a category_rank tile becomes a distribution backlog chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({
      entryId: "calc-1",
      activityId: "activity-1",
      tile: {
        kind: "category_rank",
        indicatorId: "calc-1",
        label: "Applications by school",
        description: "Where applicants came from.",
        buckets: [
          { category: "Schule A", count: 12 },
          { category: "Schule B", count: 7 },
        ],
      },
    }),
  ];

  const backlog = buildProjectImpactStoryChartBacklog(catalog, new Set(), "de");

  assert.equal(backlog.length, 1);
  assert.equal(backlog[0]?.chartType, "distribution");
  assert.equal(backlog[0]?.title, "Applications by school");
});

test("goal_assessment entries never become a backlog chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
      achieved: true,
      measuredValue: 10,
      targetValue: 10,
      comparison: "at_least",
    }),
  ];

  const backlog = buildProjectImpactStoryChartBacklog(catalog, new Set(), "de");

  assert.equal(backlog.length, 0);
});
