import assert from "node:assert/strict";
import test from "node:test";
import type { ContextCatalogEntry } from "../../shared/contracts.js";
import { buildProjectImpactStoryContextCatalog } from "./projectImpactStoryContextCatalog.js";
import { buildRun, buildUpload } from "./projectImpactStoryTestFixtures.js";

function buildContextEntry(
  overrides: Partial<ContextCatalogEntry> & { entryId: string; n: number },
): ContextCatalogEntry {
  return {
    activityId: "activity-1",
    activityName: "Activity",
    labelDe: "Verteilung: Bezirk",
    dimensionLabelDe: "Bezirk",
    shares: [{ labelDe: "Mitte", count: overrides.n }],
    eligibleChartTypes: ["hbar_target", "donut_share"],
    sourceDe: "Quelle: anmeldungen",
    ...overrides,
  };
}

test("ranks context candidates across activities by n and keeps only the top 2", () => {
  const smallEntry = buildContextEntry({
    entryId: "activity-1:context:anmeldungen.bezirk",
    n: 10,
  });
  const largestEntry = buildContextEntry({
    entryId: "activity-2:context:workshop.gruppe",
    activityId: "activity-2",
    n: 180,
  });
  const midEntry = buildContextEntry({
    entryId: "activity-1:context:anmeldungen.altersgruppe",
    n: 90,
  });

  const runOne = buildRun("run-1", "activity-1", [], [], {
    contextCatalogEntries: [smallEntry, midEntry],
  });
  const runTwo = buildRun("run-2", "activity-2", [], [], {
    contextCatalogEntries: [largestEntry],
  });

  const contextCharts = buildProjectImpactStoryContextCatalog(
    [
      { id: "activity-1", name: "Infoveranstaltungen" },
      { id: "activity-2", name: "Bewerbungstraining" },
    ],
    [runOne, runTwo],
    [
      buildUpload("upload-activity-1", "activity-1"),
      buildUpload("upload-activity-2", "activity-2"),
    ],
  );

  assert.deepEqual(
    contextCharts.map((entry) => entry.entryId),
    [
      "activity-2:context:workshop.gruppe",
      "activity-1:context:anmeldungen.altersgruppe",
    ],
  );
});

test("excludes context candidates from an activity with no current completed run", () => {
  const run = buildRun("run-1", "activity-1", [], [], {
    contextCatalogEntries: [
      buildContextEntry({
        entryId: "activity-1:context:anmeldungen.bezirk",
        n: 50,
      }),
    ],
  });

  const contextCharts = buildProjectImpactStoryContextCatalog(
    [{ id: "activity-2", name: "No run yet" }],
    [run],
    [buildUpload("upload-activity-2", "activity-2")],
  );

  assert.deepEqual(contextCharts, []);
});
