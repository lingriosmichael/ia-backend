import assert from "node:assert/strict";
import test from "node:test";
import type { ImpactCatalogItem } from "../../shared/contracts.js";
import {
  __testing,
  executeProjectImpactStoryChartAuthoring,
} from "./projectImpactStoryChartAuthoringExecution.js";
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

function confirmedPairedDelta(
  overrides: Partial<Extract<ImpactCatalogItem, { shape: "paired_delta" }>> &
    Pick<Extract<ImpactCatalogItem, { shape: "paired_delta" }>, "entryId">,
): Extract<ImpactCatalogItem, { shape: "paired_delta" }> {
  return {
    shape: "paired_delta",
    outcomeId: "outcome-1",
    outcomeTerm: "short",
    outcomeStatement: "Jugendliche kennen ihre naechsten Schritte.",
    pairLabelDe: "Selbstwirksamkeit",
    beforeValue: 2.1,
    afterValue: 3.4,
    nMatched: 12,
    nBaseline: 42,
    sourceDe: "Quelle: baseline.csv → abschluss.csv",
    scaleDirection: null,
    ...overrides,
  };
}

function confirmedPairedCategoricalShift(
  overrides: Partial<
    Extract<ImpactCatalogItem, { shape: "paired_categorical_shift" }>
  > &
    Pick<
      Extract<ImpactCatalogItem, { shape: "paired_categorical_shift" }>,
      "entryId"
    >,
): Extract<ImpactCatalogItem, { shape: "paired_categorical_shift" }> {
  return {
    shape: "paired_categorical_shift",
    outcomeId: "outcome-2",
    outcomeTerm: "short",
    outcomeStatement: "Teilnehmende fuehlen sich sicherer.",
    pairLabelDe: "Sicherheitsgefuehl",
    beforeShares: [
      { labelDe: "Ja", count: 4 },
      { labelDe: "Nein", count: 8 },
    ],
    afterShares: [
      { labelDe: "Ja", count: 9 },
      { labelDe: "Nein", count: 3 },
    ],
    nMatched: 12,
    nBaseline: 20,
    sourceDe: "Quelle: baseline.csv → abschluss.csv",
    ...overrides,
  };
}

function confirmedSingleDistribution(
  overrides: Partial<
    Extract<ImpactCatalogItem, { shape: "single_distribution" }>
  > &
    Pick<
      Extract<ImpactCatalogItem, { shape: "single_distribution" }>,
      "entryId"
    >,
): Extract<ImpactCatalogItem, { shape: "single_distribution" }> {
  return {
    shape: "single_distribution",
    outcomeId: "outcome-3",
    outcomeTerm: "long",
    outcomeStatement: "Teilnehmende kennen ihre naechsten Schritte.",
    questionLabelDe: "Naechster Schritt",
    shares: [
      { labelDe: "Praktikum", count: 18 },
      { labelDe: "Ausbildung", count: 12 },
    ],
    n: 30,
    sourceDe: "Quelle: abschluss.csv",
    ...overrides,
  };
}

test("a confirmed paired_delta entry is excluded entirely from chart authoring — no proposed chart, no mandatory inclusion", () => {
  // paired_delta is handled by the separate, always-on
  // projectImpactStoryConfirmedPairedDeltaCharts.ts instead (2026-08-30) —
  // this function must never render or count it, even defensively, in
  // case a stale/malformed request somehow still includes one.
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [confirmedPairedDelta({ entryId: "e1" })],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "comparison",
          title: "Selbstwirksamkeit",
          subtitle: null,
          narrativeReason: "",
          components: [{ entryId: "e1", shareFilter: null }],
        },
      ],
    },
  );

  assert.equal(result.chartPlan.length, 0);
  assert.equal(result.droppedChartCount, 1);
  assert.deepEqual(result.selectedEntryIds, []);
});

test("a confirmed paired_categorical_shift single component tags each bar with its group", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [confirmedPairedCategoricalShift({ entryId: "e1" })],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "comparison",
          title: "Sicherheitsgefuehl",
          subtitle: null,
          narrativeReason: "",
          components: [{ entryId: "e1", shareFilter: null }],
        },
      ],
    },
  );

  const groups = result.chartPlan[0]?.data.map((datum) => datum.group);
  assert.deepEqual(groups, ["before", "before", "after", "after"]);
});

test("a confirmed paired_categorical_shift proposed as a pie chart is dropped — a before/after shift is never a pie", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [confirmedPairedCategoricalShift({ entryId: "e1" })],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "pie",
          title: "Sicherheitsgefuehl",
          subtitle: null,
          narrativeReason: "",
          components: [{ entryId: "e1", shareFilter: null }],
        },
      ],
    },
  );

  // The disallowed-type chart is dropped, but mandatory inclusion still
  // guarantees the confirmed entry appears, this time as its own correctly
  // typed fallback chart.
  assert.equal(result.droppedChartCount, 1);
  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.chartId, "mandatory-inclusion:e1");
});

test("two confirmed single_distribution entries with comparable share labels combine into one chart", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [
      confirmedSingleDistribution({ entryId: "e1", outcomeId: "outcome-a" }),
      confirmedSingleDistribution({
        entryId: "e2",
        outcomeId: "outcome-b",
        questionLabelDe: "Naechster Schritt (Kontrollgruppe)",
      }),
    ],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "distribution",
          title: "Naechster Schritt im Vergleich",
          subtitle: null,
          narrativeReason: "",
          components: [
            { entryId: "e1", shareFilter: null },
            { entryId: "e2", shareFilter: null },
          ],
        },
      ],
    },
  );

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.data.length, 4);
  assert.equal(result.chartPlan[0]?.isConfirmedEvidence, true);
});

test("two confirmed single_distribution entries with incompatible share labels are dropped, not combined — but each still surfaces via mandatory inclusion", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [
      confirmedSingleDistribution({ entryId: "e1" }),
      confirmedSingleDistribution({
        entryId: "e2",
        shares: [
          { labelDe: "Woanders", count: 5 },
          { labelDe: "Nirgends", count: 2 },
        ],
      }),
    ],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "distribution",
          title: "Unrelated comparison",
          subtitle: null,
          narrativeReason: "",
          components: [
            { entryId: "e1", shareFilter: null },
            { entryId: "e2", shareFilter: null },
          ],
        },
      ],
    },
  );

  // The invalid combined chart is rejected outright...
  assert.equal(result.droppedChartCount, 1);
  assert.equal(
    result.chartPlan.some((chart) => chart.chartId === "c1"),
    false,
  );
  // ...but neither confirmed entry silently disappears — each gets its own
  // mandatory-inclusion chart instead.
  assert.equal(result.chartPlan.length, 2);
  assert.deepEqual(result.chartPlan.map((chart) => chart.chartId).sort(), [
    "mandatory-inclusion:e1",
    "mandatory-inclusion:e2",
  ]);
});

test("a chart mixing confirmed and unconfirmed evidence is dropped — the confirmed entry still surfaces via mandatory inclusion, the grounded one does not", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [calculationEntry({ entryId: "calc-1", activityId: "activity-1" })],
    [confirmedPairedCategoricalShift({ entryId: "confirmed-1" })],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "comparison",
          title: "Mixed",
          subtitle: null,
          narrativeReason: "",
          components: [
            { entryId: "calc-1", shareFilter: null },
            { entryId: "confirmed-1", shareFilter: null },
          ],
        },
      ],
    },
  );

  assert.equal(result.droppedChartCount, 1);
  // Mandatory inclusion only guarantees confirmed impactCatalog evidence —
  // a grounded-only entry has no such backstop in this function (that's
  // projectImpactStoryChartBacklog.ts's job in the full pipeline).
  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.chartId, "mandatory-inclusion:confirmed-1");
});

test("a confirmed entry the plan never covers is still appended via the mandatory-inclusion pass", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [confirmedPairedCategoricalShift({ entryId: "e1" })],
    { headlineKpis: [], chartPlan: [] },
  );

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.chartId, "mandatory-inclusion:e1");
  assert.equal(result.chartPlan[0]?.isConfirmedEvidence, true);
  assert.deepEqual(result.selectedEntryIds, ["e1"]);
});

test("a confirmed entry the plan already covers does not get a duplicate mandatory-inclusion chart", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [],
    [confirmedPairedCategoricalShift({ entryId: "e1" })],
    {
      headlineKpis: [],
      chartPlan: [
        {
          chartId: "c1",
          chartType: "comparison",
          title: "Sicherheitsgefuehl",
          subtitle: null,
          narrativeReason: "",
          components: [{ entryId: "e1", shareFilter: null }],
        },
      ],
    },
  );

  assert.equal(result.chartPlan.length, 1);
  assert.equal(result.chartPlan[0]?.chartId, "c1");
});

test("an unmeasured confirmed entry is never charted, mandatory-inclusion pass included", () => {
  const unmeasured: ImpactCatalogItem = {
    shape: "unmeasured",
    entryId: "e1",
    outcomeId: "outcome-1",
    outcomeTerm: "short",
    outcomeStatement: "No evidence linked yet.",
  };

  const result = executeProjectImpactStoryChartAuthoring([], [unmeasured], {
    headlineKpis: [],
    chartPlan: [
      {
        chartId: "c1",
        chartType: "comparison",
        title: "Should be dropped",
        subtitle: null,
        narrativeReason: "",
        components: [{ entryId: "e1", shareFilter: null }],
      },
    ],
  });

  assert.equal(result.chartPlan.length, 0);
});

test("a grounded-only chart still resolves via the reused chart-plan execution logic", () => {
  const result = executeProjectImpactStoryChartAuthoring(
    [calculationEntry({ entryId: "e1", activityId: "activity-1" })],
    [],
    {
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
    },
  );

  assert.equal(result.headlineKpis.length, 1);
  assert.equal(result.headlineKpis[0]?.value, 100);
});

test("applyShareFilter keeps a filter that retains at least half the real mass", () => {
  const shares = [
    { labelDe: "Praktikum", count: 18 },
    { labelDe: "Ausbildung", count: 12 },
  ];

  const kept = __testing.applyShareFilter(shares, ["Praktikum"]);

  assert.deepEqual(kept, [{ labelDe: "Praktikum", count: 18 }]);
});

test("applyShareFilter rejects a filter that would drop more than half the real mass", () => {
  const shares = [
    { labelDe: "Praktikum", count: 18 },
    { labelDe: "Ausbildung", count: 12 },
  ];

  const kept = __testing.applyShareFilter(shares, ["Ausbildung"]);

  assert.deepEqual(kept, shares);
});

test("applyShareFilter ignores an invented label rather than dropping every real share", () => {
  const shares = [{ labelDe: "Praktikum", count: 18 }];

  const kept = __testing.applyShareFilter(shares, ["Erfundene Kategorie"]);

  assert.deepEqual(kept, shares);
});

test("haveComparableShareLabelSets accepts identical label sets", () => {
  assert.equal(
    __testing.haveComparableShareLabelSets(
      [{ labelDe: "Ja" }, { labelDe: "Nein" }],
      [{ labelDe: "ja" }, { labelDe: " Nein " }],
    ),
    true,
  );
});

test("haveComparableShareLabelSets rejects disjoint label sets", () => {
  assert.equal(
    __testing.haveComparableShareLabelSets(
      [{ labelDe: "Ja" }, { labelDe: "Nein" }],
      [{ labelDe: "Praktikum" }, { labelDe: "Ausbildung" }],
    ),
    false,
  );
});
