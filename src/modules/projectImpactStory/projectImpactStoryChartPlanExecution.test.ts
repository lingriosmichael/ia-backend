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
    measuredValue: null,
    targetValue: null,
    comparison: null,
    ...overrides,
  };
}

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

function pairedStoryDeltaEntry(
  overrides: Partial<
    Extract<ProjectImpactStoryCatalogEntry, { kind: "paired_story_delta" }>
  > &
    Pick<
      Extract<ProjectImpactStoryCatalogEntry, { kind: "paired_story_delta" }>,
      "entryId" | "activityId"
    >,
): Extract<ProjectImpactStoryCatalogEntry, { kind: "paired_story_delta" }> {
  return {
    kind: "paired_story_delta",
    activityName: overrides.activityId,
    pairLabelDe: "Wellbeing Skala",
    beforeValue: 2.1,
    afterValue: 3.4,
    nMatched: 12,
    nBaseline: 15,
    sourceDe: "Quelle: vorher.csv → nachher.csv",
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

test("a single achieved goal_assessment becomes a 'good' KPI with no callout", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
      achieved: true,
      measuredValue: 65,
      targetValue: 65,
      comparison: "at_least",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Aktive Mentor:innen",
        entryIds: ["g1"],
        aggregation: "single",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis.length, 1);
  assert.equal(result.headlineKpis[0]?.value, 65);
  assert.equal(result.headlineKpis[0]?.status, "good");
  assert.equal(result.headlineKpis[0]?.statusCallout, undefined);
});

test("a not-achieved goal far below target becomes a 'risk' KPI with a callout", () => {
  // The tandem-meetings case: average 1.9 of a 10-meeting target.
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "not_achieved",
      achieved: false,
      measuredValue: 1.9,
      targetValue: 10,
      comparison: "at_least",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Tandemtreffen",
        entryIds: ["g1"],
        aggregation: "single",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis[0]?.status, "risk");
  assert.equal(
    result.headlineKpis[0]?.statusCallout,
    "Braucht Aufmerksamkeit: Ziel bisher zu 19% erreicht.",
  );
});

test("statusCallout text follows the requested language", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "not_achieved",
      achieved: false,
      measuredValue: 1.9,
      targetValue: 10,
      comparison: "at_least",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(
    catalog,
    {
      headlineKpis: [
        {
          kpiId: "k1",
          label: "Tandem meetings",
          entryIds: ["g1"],
          aggregation: "single",
          narrativeReason: "",
        },
      ],
      chartPlan: [],
    },
    "en",
  );

  assert.equal(result.headlineKpis[0]?.status, "risk");
  assert.equal(
    result.headlineKpis[0]?.statusCallout,
    "Needs attention: 19% of target reached so far.",
  );
});

test("a not-achieved goal close to target becomes a 'warn' KPI", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "not_achieved",
      achieved: false,
      measuredValue: 305,
      targetValue: 350,
      comparison: "at_least",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "Schüler:innen erreicht",
        entryIds: ["g1"],
        aggregation: "single",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis[0]?.status, "warn");
  assert.ok(result.headlineKpis[0]?.statusCallout);
});

test("a single goal_assessment with no measured/target value is dropped, not defaulted", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "qualitative_evidence_only",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [
      {
        kpiId: "k1",
        label: "No numbers here",
        entryIds: ["g1"],
        aggregation: "single",
        narrativeReason: "",
      },
    ],
    chartPlan: [],
  });

  assert.equal(result.headlineKpis.length, 0);
  assert.equal(result.droppedKpiCount, 1);
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

test("drops a second chart that visualizes the identical set of catalog entries as an earlier one", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
    }),
    goalAssessmentEntry({
      entryId: "g2",
      activityId: "activity-2",
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
        entryIds: ["g1", "g2"],
        narrativeReason: "",
      },
      {
        chartId: "c2",
        chartType: "bar",
        title: "Goal outcomes again",
        subtitle: null,
        // Same two entries, reversed order and a different chart type —
        // still the identical underlying fact set.
        entryIds: ["g2", "g1"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.title, "Goal outcomes");
  assert.equal(result.droppedChartCount, 1);
});

test("does not drop two charts that share some but not all of the same entries", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    goalAssessmentEntry({
      entryId: "g1",
      activityId: "activity-1",
      assessmentStatus: "achieved",
    }),
    goalAssessmentEntry({
      entryId: "g2",
      activityId: "activity-2",
      assessmentStatus: "not_achieved",
    }),
    goalAssessmentEntry({
      entryId: "g3",
      activityId: "activity-3",
      assessmentStatus: "achieved",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "distribution",
        title: "Goal outcomes A",
        subtitle: null,
        entryIds: ["g1", "g2"],
        narrativeReason: "",
      },
      {
        chartId: "c2",
        chartType: "distribution",
        title: "Goal outcomes B",
        subtitle: null,
        entryIds: ["g2", "g3"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 2);
  assert.equal(result.droppedChartCount, 0);
});

test("a selected context distribution becomes a real chart-plan chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    contextDistributionEntry({
      entryId: "ctx-1",
      activityId: "activity-1",
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "chart-1",
        chartType: "distribution",
        title: "Teilnehmende nach Bezirk",
        subtitle: null,
        entryIds: ["ctx-1"],
        narrativeReason: "Shows subgroup mix.",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.dataKind, "category");
  assert.deepEqual(result.chartPlan[0]?.data, [
    { label: "Mitte", value: 18 },
    { label: "Nord", value: 11 },
  ]);
});

test("a context distribution chart is dropped when the chosen chart type is ineligible", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    contextDistributionEntry({
      entryId: "ctx-1",
      activityId: "activity-1",
      eligibleChartTypes: ["hbar_target"],
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "chart-1",
        chartType: "pie",
        title: "Teilnehmende nach Bezirk",
        subtitle: null,
        entryIds: ["ctx-1"],
        narrativeReason: "Shows subgroup mix.",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 0);
  assert.equal(result.droppedChartCount, 1);
});

test("a selected paired story delta becomes an exploratory before/after comparison chart", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    pairedStoryDeltaEntry({
      entryId: "psd-1",
      activityId: "activity-1",
      beforeValue: 2.1,
      afterValue: 3.4,
    }),
  ];

  const result = executeProjectImpactStoryChartPlan(
    catalog,
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "chart-1",
          chartType: "comparison",
          title: "Beobachtete Veränderung",
          subtitle: null,
          entryIds: ["psd-1"],
          narrativeReason:
            "Vorher/nachher beobachtet, kein bestätigtes Ergebnis.",
        },
      ],
    },
    "de",
  );

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.isExploratory, true);
  assert.deepEqual(result.chartPlan[0]?.data, [
    { label: "Vorher", value: 2.1 },
    { label: "Nachher", value: 3.4 },
  ]);
  assert.deepEqual(result.selectedEntryIds, ["psd-1"]);
});

test("a paired story delta chart with an ineligible chart type is dropped", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    pairedStoryDeltaEntry({ entryId: "psd-1", activityId: "activity-1" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "chart-1",
        chartType: "pie",
        title: "Beobachtete Veränderung",
        subtitle: null,
        entryIds: ["psd-1"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 0);
  assert.equal(result.droppedChartCount, 1);
});

test("a chart built from non-exploratory entries never carries isExploratory", () => {
  const catalog: ProjectImpactStoryCatalogEntry[] = [
    contextDistributionEntry({ entryId: "ctx-1", activityId: "activity-1" }),
  ];

  const result = executeProjectImpactStoryChartPlan(catalog, {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "chart-1",
        chartType: "distribution",
        title: "Teilnehmende nach Bezirk",
        subtitle: null,
        entryIds: ["ctx-1"],
        narrativeReason: "",
      },
    ],
  });

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.isExploratory, undefined);
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
