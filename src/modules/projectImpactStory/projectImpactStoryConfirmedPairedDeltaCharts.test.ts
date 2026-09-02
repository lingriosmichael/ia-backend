import assert from "node:assert/strict";
import test from "node:test";
import type { ImpactCatalogItem } from "../../shared/contracts.js";
import { buildProjectImpactStoryConfirmedPairedDeltaCharts } from "./projectImpactStoryConfirmedPairedDeltaCharts.js";

function pairedDelta(
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

test("returns no charts when the catalog has no paired_delta entries", () => {
  const charts = buildProjectImpactStoryConfirmedPairedDeltaCharts([], "de");

  assert.deepEqual(charts, []);
});

test("groups every scale-compatible pair into one shared chart, colored by before/after", () => {
  const charts = buildProjectImpactStoryConfirmedPairedDeltaCharts(
    [
      pairedDelta({ entryId: "e1", pairLabelDe: "Selbstwirksamkeit" }),
      pairedDelta({
        entryId: "e2",
        pairLabelDe: "Sicherheitsgefuehl",
        beforeValue: 40,
        afterValue: 85,
      }),
    ],
    "de",
  );

  assert.equal(charts.length, 1);
  const [chart] = charts;
  assert.equal(chart?.chartId, "confirmed-paired-delta-overview");
  assert.equal(chart?.isConfirmedEvidence, true);
  assert.equal(chart?.data.length, 4);
  assert.deepEqual(
    chart?.data.map((datum) => datum.group),
    ["before", "after", "before", "after"],
  );
  assert.deepEqual(
    chart?.data.map((datum) => datum.value),
    [2.1, 3.4, 40, 85],
  );
});

test("excludes a lower_is_better pair from the shared chart and gives it its own chart instead", () => {
  const charts = buildProjectImpactStoryConfirmedPairedDeltaCharts(
    [
      pairedDelta({ entryId: "e1", scaleDirection: "higher_is_better" }),
      pairedDelta({
        entryId: "e2",
        pairLabelDe: "Tage ohne Kontakt",
        scaleDirection: "lower_is_better",
        beforeValue: 20,
        afterValue: 5,
      }),
    ],
    "de",
  );

  assert.equal(charts.length, 2);
  const overview = charts.find(
    (chart) => chart.chartId === "confirmed-paired-delta-overview",
  );
  const reverseScored = charts.find(
    (chart) => chart.chartId === "confirmed-paired-delta:e2",
  );
  assert.ok(overview, "expected the shared overview chart to exist");
  assert.equal(overview?.data.length, 2, "only the comparable pair, not e2");
  assert.ok(
    reverseScored,
    "expected a standalone chart for the reverse-scored pair",
  );
  assert.equal(reverseScored?.title, "Tage ohne Kontakt");
  assert.deepEqual(
    reverseScored?.data.map((datum) => datum.value),
    [20, 5],
  );
});

test("a project with only a lower_is_better pair gets no shared overview chart, just the standalone one", () => {
  const charts = buildProjectImpactStoryConfirmedPairedDeltaCharts(
    [pairedDelta({ entryId: "e1", scaleDirection: "lower_is_better" })],
    "de",
  );

  assert.equal(charts.length, 1);
  assert.equal(charts[0]?.chartId, "confirmed-paired-delta:e1");
});

test("non-paired_delta confirmed shapes are ignored", () => {
  const unmeasured: ImpactCatalogItem = {
    shape: "unmeasured",
    entryId: "e1",
    outcomeId: "outcome-1",
    outcomeTerm: "short",
    outcomeStatement: "No evidence linked yet.",
  };

  const charts = buildProjectImpactStoryConfirmedPairedDeltaCharts(
    [unmeasured],
    "de",
  );

  assert.deepEqual(charts, []);
});
