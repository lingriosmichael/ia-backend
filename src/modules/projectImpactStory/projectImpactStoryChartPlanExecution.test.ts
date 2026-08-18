import assert from "node:assert/strict";
import test from "node:test";
import { executeProjectImpactStoryChartPlan } from "./projectImpactStoryChartPlanExecution.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

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
    ...overrides,
  };
}

test("aggregation 'single' returns the referenced calculation's own value", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Reached",
        entryIds: ["e1"],
        aggregation: "single",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis.length, 1);
  assert.equal(result.headlineKpis[0]?.value, 100);
  assert.equal(result.droppedKpiCount, 0);
});

test("aggregation 'count' counts goal_assessment entries regardless of value", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
    }),
    goalAssessmentEntry({
      entryId: "g2",
      activityId: "activity-2",
      assessmentStatus: "achieved",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Achieved goals",
        entryIds: ["g1", "g2"],
        aggregation: "count",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis[0]?.value, 2);
});

test("sum aggregation across activities requires matching toolName/unit/denominatorType", () => {
  const comparable: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1" }),
    calculationEntry({ entryId: "e2", activityId: "activity-2" }),
  ];

  const summed = executeProjectImpactStoryChartPlan(comparable, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Total reached",
        entryIds: ["e1", "e2"],
        aggregation: "sum",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });
  assert.equal(summed.headlineKpis[0]?.value, 200);
  assert.equal(summed.droppedKpiCount, 0);

  const incomparable: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1", unit: "rows" }),
    calculationEntry({
      entryId: "e2",
      activityId: "activity-2",
      unit: "distinct_values",
      toolName: "count_distinct",
    }),
  ];

  const rejected = executeProjectImpactStoryChartPlan(incomparable, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Total reached",
        entryIds: ["e1", "e2"],
        aggregation: "sum",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  // Never silently sum incompatible measures — the candidate is dropped
  // entirely rather than producing a wrong number.
  assert.equal(rejected.headlineKpis.length, 0);
  assert.equal(rejected.droppedKpiCount, 1);
});

test("drops a KPI that references an unknown entryId, even if Python's own grounding already should have caught it", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Reached",
        entryIds: ["e1", "does-not-exist"],
        aggregation: "sum",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis.length, 0);
  assert.equal(result.droppedKpiCount, 1);
});

test("builds distribution chart data by grouping goal_assessment entries by status", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
    }),
    goalAssessmentEntry({
      entryId: "g2",
      activityId: "activity-2",
      assessmentStatus: "achieved",
    }),
    goalAssessmentEntry({
      entryId: "g3",
      activityId: "activity-3",
      assessmentStatus: "not_achieved",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "distribution",
        title: "Goal outcomes",
        subtitle: null,
        entryIds: ["g1", "g2", "g3"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.dataKind, "status");
  assert.equal(result.chartPlan[0]?.valueFormat, "number");
  assert.deepEqual(
    result.chartPlan[0]?.data.sort((a, b) => a.label.localeCompare(b.label)),
    [
      { label: "achieved", value: 2 },
      { label: "not_achieved", value: 1 },
    ],
  );
});

test("drops a chart whose chartType is not in the allowed set", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "not-a-real-chart-type",
        title: "Reached",
        subtitle: null,
        entryIds: ["e1"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 0);
  assert.equal(result.droppedChartCount, 1);
});

test("builds a comparison chart from same-measure kpi entries across activities", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({ entryId: "e1", activityId: "activity-1" }),
    calculationEntry({ entryId: "e2", activityId: "activity-2" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "comparison",
        title: "Reached by activity",
        subtitle: null,
        entryIds: ["e1", "e2"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.dataKind, "activity");
  assert.equal(result.chartPlan[0]?.valueFormat, "number");
  assert.deepEqual(result.chartPlan[0]?.data, [
    { label: "activity-1", value: 100 },
    { label: "activity-2", value: 100 },
  ]);
});

test("builds a comparison chart from same-activity kpi entries by their own label, not the repeated activity name", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({
      entryId: "e1",
      activityId: "activity-1",
      tile: {
        kind: "kpi",
        indicatorId: "e1",
        label: "Bewerbungen",
        description: "",
        value: 80,
        formatAs: "number",
      },
    }),
    calculationEntry({
      entryId: "e2",
      activityId: "activity-1",
      tile: {
        kind: "kpi",
        indicatorId: "e2",
        label: "Ausgewählte Mentor:innen",
        description: "",
        value: 20,
        formatAs: "number",
      },
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "comparison",
        title: "Auswahl-Trichter",
        subtitle: null,
        entryIds: ["e1", "e2"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.dataKind, "activity");
  assert.deepEqual(result.chartPlan[0]?.data, [
    { label: "Bewerbungen", value: 80 },
    { label: "Ausgewählte Mentor:innen", value: 20 },
  ]);
});

test("marks a ratio-based trend chart as valueFormat percentage, not a raw fraction", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({
      entryId: "e1",
      activityId: "activity-1",
      tile: {
        kind: "line_series",
        indicatorId: "e1",
        label: "Completion rate",
        description: "",
        points: [
          {
            period: "2026-01",
            count: null,
            numeratorCount: 20,
            denominatorCount: 40,
          },
        ],
      },
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "line",
        title: "Completion over time",
        subtitle: null,
        entryIds: ["e1"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan[0]?.dataKind, "period");
  assert.equal(result.chartPlan[0]?.valueFormat, "percentage");
  assert.deepEqual(result.chartPlan[0]?.data, [
    { label: "2026-01", value: 0.5 },
  ]);
});

test("marks a cross-activity ratio comparison as valueFormat percentage", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    calculationEntry({
      entryId: "e1",
      activityId: "activity-1",
      toolName: "calculate_ratio",
      unit: "ratio",
      tile: {
        kind: "kpi",
        indicatorId: "e1",
        label: "Completion rate",
        description: "",
        value: 0.4,
        formatAs: "percentage",
      },
    }),
    calculationEntry({
      entryId: "e2",
      activityId: "activity-2",
      toolName: "calculate_ratio",
      unit: "ratio",
      tile: {
        kind: "kpi",
        indicatorId: "e2",
        label: "Completion rate",
        description: "",
        value: 0.6,
        formatAs: "percentage",
      },
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "comparison",
        title: "Completion by activity",
        subtitle: null,
        entryIds: ["e1", "e2"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan[0]?.dataKind, "activity");
  assert.equal(result.chartPlan[0]?.valueFormat, "percentage");
});
