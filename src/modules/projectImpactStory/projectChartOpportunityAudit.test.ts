import assert from "node:assert/strict";
import test from "node:test";
import type { ContextCatalogEntry } from "../../shared/contracts.js";
import { buildProjectChartOpportunityAudit } from "./projectChartOpportunityAudit.js";
import {
  buildCalculation,
  buildGoalAssessment,
  buildRun,
  buildUpload,
} from "./projectImpactStoryTestFixtures.js";

test("marks a grounded calculation and an achieved goal assessment as ready_now", () => {
  const calculation = buildCalculation("calc-1", { value: 42 });
  const run = buildRun(
    "run-1",
    "activity-1",
    [calculation],
    [buildGoalAssessment(["calc-1"], { assessmentStatus: "achieved" })],
  );

  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
  );

  const calculationEntry = audit.find(
    (entry) => entry.entryId === "activity-1:calc:calc-1",
  );
  const goalEntry = audit.find(
    (entry) => entry.entryId === "activity-1:goal:goal-1",
  );

  assert.equal(calculationEntry?.status, "ready_now");
  assert.equal(goalEntry?.status, "ready_now");
});

test("classifies requires_capability as blocked_by_extraction and requires_clarification as blocked_by_missing_data", () => {
  const run = buildRun(
    "run-1",
    "activity-1",
    [],
    [
      buildGoalAssessment([], {
        goalId: "goal-capability",
        assessmentStatus: "requires_capability",
      }),
      buildGoalAssessment([], {
        goalId: "goal-clarification",
        assessmentStatus: "requires_clarification",
      }),
    ],
  );

  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
  );

  const capabilityEntry = audit.find(
    (entry) => entry.entryId === "activity-1:goal:goal-capability",
  );
  const clarificationEntry = audit.find(
    (entry) => entry.entryId === "activity-1:goal:goal-clarification",
  );

  assert.equal(capabilityEntry?.status, "blocked_by_extraction");
  assert.equal(clarificationEntry?.status, "blocked_by_missing_data");
});

test("flags an activity with no current V2 run as blocked_by_missing_data", () => {
  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [],
    [buildUpload("upload-activity-1", "activity-1")],
  );

  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.status, "blocked_by_missing_data");
  assert.equal(audit[0]?.reasonCode, "stale_or_missing_analysis_run");
});

test("flags an activity with no uploads at all differently from one with stale evidence", () => {
  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [],
    [],
  );

  assert.equal(audit[0]?.reasonCode, "no_evidence_uploaded");
});

test("includes a materialized context distribution as ready_now with its source table", () => {
  const contextEntry: ContextCatalogEntry = {
    entryId: "activity-1:context:survey.bezirk",
    activityId: "activity-1",
    activityName: "Workshop A",
    labelDe: "Verteilung: Bezirk",
    dimensionLabelDe: "Bezirk",
    shares: [{ labelDe: "Mitte", count: 3 }],
    n: 3,
    eligibleChartTypes: ["hbar_target", "donut_share"],
    sourceDe: "Quelle: survey",
  };
  const run = buildRun("run-1", "activity-1", [], [], {
    contextCatalogEntries: [contextEntry],
  });

  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
  );

  const entry = audit.find((e) => e.entryId === contextEntry.entryId);
  assert.equal(entry?.status, "ready_now");
  assert.deepEqual(entry?.sourceTables, ["survey"]);
});

test("surfaces contextCandidatesExcludedByMissingEpistemicRole as a blocked_by_extraction opportunity", () => {
  const run = buildRun("run-1", "activity-1", [], [], {
    diagnostics: {
      goalCount: 0,
      outputGoalCount: 0,
      evidenceCount: 1,
      plannedToolRequestCount: 0,
      executedToolCallCount: 0,
      calculationCount: 0,
      validationIssueCount: 0,
      goalStatusCounts: {
        achieved: 0,
        notAchieved: 0,
        evidenceCompiled: 0,
        qualitativeEvidenceOnly: 0,
        mixedEvidence: 0,
        requiresClarification: 0,
        requiresCapability: 0,
      },
      contextExtraction: {
        totalCategoricalColumnsSeen: 0,
        contextCandidatesProposed: 0,
        contextCandidatesExcludedByReferencedStrings: 0,
        contextCandidatesExcludedByMissingEpistemicRole: 2,
        contextCandidatesMaterialized: 0,
        preparedTableFallbackTableCount: 1,
      },
    },
  });

  const audit = buildProjectChartOpportunityAudit(
    [{ id: "activity-1", name: "Workshop A" }],
    [run],
    [buildUpload("upload-activity-1", "activity-1")],
  );

  const blockedEntry = audit.find(
    (entry) => entry.reasonCode === "missing_epistemic_role",
  );
  assert.equal(blockedEntry?.status, "blocked_by_extraction");
  assert.match(blockedEntry?.reasonDetail ?? "", /2 evidence column/);
});
