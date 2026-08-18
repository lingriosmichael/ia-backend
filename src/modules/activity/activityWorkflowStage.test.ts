import assert from "node:assert/strict";
import test from "node:test";
import { computeActivityWorkflowStage } from "./activityWorkflowStage.js";
import type { ActivityWorkflowStageInput } from "./activityWorkflowStage.js";
import type { InterpretationQuestionCode } from "../../shared/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const EARLIER = new Date("2025-12-01T00:00:00.000Z");

function makeJob(
  overrides: Partial<ActivityWorkflowStageInput["jobs"][number]>,
): ActivityWorkflowStageInput["jobs"][number] {
  return {
    uploadMetadataId: "upload-1",
    jobType: "evidence_processing",
    status: "completed",
    createdAt: NOW,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<{
    uploadMetadataId: string;
    questions: Array<{
      isBlocking?: boolean | null;
      kind: "single_choice" | "free_text" | "merge_confirmation";
      status: "pending" | "answered";
      questionCode?: InterpretationQuestionCode | null;
      targetColumnName?: string | null;
    }>;
  }> = {},
) {
  return {
    uploadMetadataId: "upload-1",
    questions: [],
    ...overrides,
  } as never;
}

function makeInput(
  overrides: Partial<ActivityWorkflowStageInput> = {},
): ActivityWorkflowStageInput {
  return {
    isAcknowledged: false,
    uploadIds: ["upload-1"],
    jobs: [],
    results: [],
    hasPendingQualitativeCodingReview: false,
    hasLinkageResultIfApplicable: false,
    ...overrides,
  };
}

test("an activity with no uploads is no_evidence", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({ uploadIds: [], isAcknowledged: true }),
  );
  assert.equal(stage, "no_evidence");
});

test("an acknowledged activity is reviewed, even if everything else looks unfinished", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      isAcknowledged: true,
      jobs: [makeJob({ status: "awaiting_privacy_review" })],
    }),
  );
  assert.equal(stage, "reviewed");
});

test("an upload awaiting privacy review takes precedence over everything after it", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      jobs: [
        makeJob({ status: "awaiting_privacy_review", createdAt: NOW }),
        makeJob({ status: "queued", createdAt: EARLIER }),
      ],
    }),
  );
  assert.equal(stage, "privacy_review");
});

test("only the latest evidence-processing job per upload counts for privacy review", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      jobs: [
        makeJob({ status: "awaiting_privacy_review", createdAt: EARLIER }),
        makeJob({ status: "completed", createdAt: NOW }),
      ],
    }),
  );
  assert.notEqual(stage, "privacy_review");
});

test("an active dataset_interpretation job means analysis_running", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      jobs: [
        makeJob({ jobType: "dataset_interpretation", status: "processing" }),
      ],
    }),
  );
  assert.equal(stage, "analysis_running");
});

test("a completed dataset_interpretation job does not count as active", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      jobs: [
        makeJob({ jobType: "dataset_interpretation", status: "completed" }),
      ],
      results: [makeResult()],
    }),
  );
  assert.notEqual(stage, "analysis_running");
});

test("a pending blocking question means needs_clarification", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      results: [
        makeResult({
          questions: [
            { isBlocking: true, kind: "single_choice", status: "pending" },
          ],
        }),
      ],
    }),
  );
  assert.equal(stage, "needs_clarification");
});

test("a stale structural identifier epistemic-role question does not block clarification", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      results: [
        makeResult({
          questions: [
            {
              isBlocking: true,
              kind: "single_choice",
              status: "pending",
              questionCode: "epistemic_role_clarification",
              targetColumnName: "vorname",
            },
          ],
        }),
      ],
    }),
  );
  assert.notEqual(stage, "needs_clarification");
});

test("a non-blocking pending question does not trigger needs_clarification", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      results: [
        makeResult({
          questions: [
            { isBlocking: false, kind: "free_text", status: "pending" },
          ],
        }),
      ],
    }),
  );
  assert.notEqual(stage, "needs_clarification");
});

test("a pending goal-grounding question does not block the interpretation workflow stage", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      results: [
        makeResult({
          questions: [
            {
              isBlocking: true,
              kind: "free_text",
              status: "pending",
              questionCode: "positive_status_values",
            },
          ],
        }),
      ],
    }),
  );
  assert.notEqual(stage, "needs_clarification");
});

test("some but not all uploads interpreted is analysis_pending", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1", "upload-2"],
      results: [makeResult({ uploadMetadataId: "upload-1" })],
      hasLinkageResultIfApplicable: true,
    }),
  );
  assert.equal(stage, "analysis_pending");
});

test("partial interpretation waits for every upload before surfacing blocking questions", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1", "upload-2"],
      results: [
        makeResult({
          uploadMetadataId: "upload-1",
          questions: [
            { isBlocking: true, kind: "single_choice", status: "pending" },
          ],
        }),
      ],
      hasLinkageResultIfApplicable: true,
    }),
  );
  assert.equal(stage, "analysis_pending");
});

test("no results yet at all is analysis_pending", () => {
  const stage = computeActivityWorkflowStage(makeInput());
  assert.equal(stage, "analysis_pending");
});

test("a single-upload activity fully interpreted is assessment_ready without needing linkage", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1"],
      results: [makeResult({ uploadMetadataId: "upload-1" })],
      hasLinkageResultIfApplicable: false,
    }),
  );
  assert.equal(stage, "assessment_ready");
});

test("a fully interpreted activity with a pending qualitative coding review is qualitative_review", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1"],
      results: [makeResult({ uploadMetadataId: "upload-1" })],
      hasPendingQualitativeCodingReview: true,
      hasLinkageResultIfApplicable: true,
    }),
  );
  assert.equal(stage, "qualitative_review");
});

test("a fully-interpreted multi-upload activity without a linkage result is goal_review (§11)", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1", "upload-2"],
      results: [
        makeResult({ uploadMetadataId: "upload-1" }),
        makeResult({ uploadMetadataId: "upload-2" }),
      ],
      hasLinkageResultIfApplicable: false,
    }),
  );
  assert.equal(stage, "goal_review");
});

test("a fully-interpreted multi-upload activity with a linkage result is assessment_ready", () => {
  const stage = computeActivityWorkflowStage(
    makeInput({
      uploadIds: ["upload-1", "upload-2"],
      results: [
        makeResult({ uploadMetadataId: "upload-1" }),
        makeResult({ uploadMetadataId: "upload-2" }),
      ],
      hasLinkageResultIfApplicable: true,
    }),
  );
  assert.equal(stage, "assessment_ready");
});
