import assert from "node:assert/strict";
import test from "node:test";
import { computeProjectImpactStoryStaleness } from "./projectImpactStoryStaleness.js";

const NOW = new Date("2026-08-28T10:00:00.000Z");

function buildSnapshot() {
  return {
    sourceSnapshot: [
      {
        activityId: "activity-1",
        activityAnalysisRunId: "run-1",
      },
    ],
  };
}

function buildCurrentActivities() {
  return [{ id: "activity-1" }];
}

function buildCurrentRuns() {
  return [
    {
      id: "run-1",
      activityId: "activity-1",
      status: "completed",
      createdAt: NOW,
    },
  ];
}

test("is stale when confirmed links exist but no matching overlay has been generated yet", () => {
  const result = computeProjectImpactStoryStaleness(
    buildSnapshot(),
    buildCurrentActivities(),
    buildCurrentRuns(),
    [{ linkId: "link-1", updatedAt: NOW }],
    null,
  );

  assert.equal(result.isStale, true);
});

test("is stale when a confirmed link was updated after the matching overlay was generated", () => {
  const result = computeProjectImpactStoryStaleness(
    buildSnapshot(),
    buildCurrentActivities(),
    buildCurrentRuns(),
    [{ linkId: "link-1", updatedAt: NOW }],
    {
      updatedAt: new Date("2026-08-28T09:00:00.000Z"),
      impactCatalog: [{ entryId: "link-1" }],
    },
  );

  assert.equal(result.isStale, true);
});

test("is stale when the overlay still references more impact entries than the current confirmed-link set", () => {
  const result = computeProjectImpactStoryStaleness(
    buildSnapshot(),
    buildCurrentActivities(),
    buildCurrentRuns(),
    [],
    {
      updatedAt: NOW,
      impactCatalog: [{ entryId: "link-1" }],
    },
  );

  assert.equal(result.isStale, true);
});

test("is not stale when runs, activities, and confirmed links still match the overlay generation point", () => {
  const result = computeProjectImpactStoryStaleness(
    buildSnapshot(),
    buildCurrentActivities(),
    buildCurrentRuns(),
    [{ linkId: "link-1", updatedAt: new Date("2026-08-28T09:00:00.000Z") }],
    {
      updatedAt: NOW,
      impactCatalog: [{ entryId: "link-1" }],
    },
  );

  assert.equal(result.isStale, false);
});
