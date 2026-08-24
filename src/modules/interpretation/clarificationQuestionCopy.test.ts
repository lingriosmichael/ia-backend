import assert from "node:assert/strict";
import test from "node:test";
import {
  renderClarificationQuestion,
  type ClarificationQuestionRenderInput,
} from "./clarificationQuestionCopy.js";
import { interpretationQuestionCodeValues } from "../../shared/contracts.js";

function baseInput(
  overrides: Partial<ClarificationQuestionRenderInput>,
): ClarificationQuestionRenderInput {
  return {
    questionCode: null,
    targetTableName: null,
    targetColumnName: null,
    language: "en",
    questionData: null,
    rawPrompt: "",
    rawOptions: null,
    ...overrides,
  };
}

test("every closed InterpretationQuestionCode has a working renderer", () => {
  for (const questionCode of interpretationQuestionCodeValues) {
    const rendered = renderClarificationQuestion(
      baseInput({
        questionCode,
        targetTableName: "table_one",
        targetColumnName: "column_one",
        questionData: {
          candidateColumnNames: ["column_one", "column_two"],
          observedStatusValues: ["completed", "cancelled"],
          variants: ["completed", "complete"],
          observedValues: ["ja", "nein"],
        },
      }),
    );

    assert.notEqual(rendered.userFacingPrompt, "");
    assert.doesNotMatch(rendered.userFacingPrompt, /\{[a-zA-Z]+\}/);
  }
});

test("row_grain renders the exact ported German/English sentence, table-name only", () => {
  const german = renderClarificationQuestion(
    baseInput({
      questionCode: "row_grain",
      targetTableName: "anmeldungen",
      language: "de",
    }),
  );
  assert.equal(
    german.userFacingPrompt,
    "Wofür steht eine Zeile in der Tabelle 'anmeldungen'?",
  );
  assert.equal(german.userFacingOptions, null);

  const english = renderClarificationQuestion(
    baseInput({
      questionCode: "row_grain",
      targetTableName: "anmeldungen",
      language: "en",
    }),
  );
  assert.equal(
    english.userFacingPrompt,
    "What does one row in the table 'anmeldungen' stand for?",
  );
});

test("positive_status_values interpolates {values} from questionData and mirrors it as options", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: "positive_status_values",
      targetColumnName: "status",
      language: "en",
      questionData: { observedStatusValues: ["completed", "cancelled"] },
    }),
  );
  assert.equal(
    rendered.userFacingPrompt,
    "Which values in the column 'status' should count as a successful or positive status? Select every value that should count. Found values: 'completed', 'cancelled'.",
  );
  assert.deepEqual(rendered.userFacingOptions, [
    { value: "completed", label: "completed" },
    { value: "cancelled", label: "cancelled" },
  ]);
});

test("positive_status_values falls back to empty values gracefully when questionData is absent", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: "positive_status_values",
      targetColumnName: "status",
      language: "en",
      questionData: null,
    }),
  );
  assert.match(rendered.userFacingPrompt, /Found values: \.$/);
  assert.equal(rendered.userFacingOptions, null);
});

test("primary_status_field/primary_date_field render dynamic candidate column names as options", () => {
  const statusField = renderClarificationQuestion(
    baseInput({
      questionCode: "primary_status_field",
      targetTableName: "applications",
      language: "en",
      questionData: { candidateColumnNames: ["status", "stage"] },
    }),
  );
  assert.deepEqual(statusField.userFacingOptions, [
    { value: "status", label: "status" },
    { value: "stage", label: "stage" },
  ]);

  const dateField = renderClarificationQuestion(
    baseInput({
      questionCode: "primary_date_field",
      targetTableName: "applications",
      language: "en",
      questionData: { candidateColumnNames: ["created_at", "submitted_at"] },
    }),
  );
  assert.deepEqual(dateField.userFacingOptions, [
    { value: "created_at", label: "created_at" },
    { value: "submitted_at", label: "submitted_at" },
  ]);
});

test("normalization_merge interpolates {field}/{variants} and keeps fixed merge_confirmation options", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: "normalization_merge",
      targetColumnName: "status",
      language: "en",
      questionData: { variants: ["completed", "complete"] },
    }),
  );
  assert.equal(
    rendered.userFacingPrompt,
    "Do these values in the column 'status' mean the same thing: 'completed', 'complete'?",
  );
  assert.deepEqual(rendered.userFacingOptions, [
    {
      value: "Yes, they mean the same thing",
      label: "Yes, they mean the same thing",
    },
    {
      value: "No, they mean different things",
      label: "No, they mean different things",
    },
  ]);
});

test("cohort_tag renders the previously ia_backend-owned template unchanged", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: "cohort_tag",
      targetTableName: "baseline",
      language: "en",
    }),
  );
  assert.equal(
    rendered.userFacingPrompt,
    `Who is the table 'baseline' about? For example "young people" or "mentors". ` +
      `This helps compare only the right baseline and endline data with each other. ` +
      `Answer "not applicable" if this project only has a single cohort.`,
  );
});

test("filter_value_grounding renders the column's real observedValues as options, never invented text", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: "filter_value_grounding",
      targetColumnName: "treffen_durchgefuehrt",
      language: "en",
      questionData: { observedValues: ["ja", "nein"] },
    }),
  );
  assert.deepEqual(rendered.userFacingOptions, [
    { value: "ja", label: "ja" },
    { value: "nein", label: "nein" },
  ]);
});

test("the same questionCode/table/column renders identically regardless of which pipeline stage supplied it", () => {
  // This is the concrete regression test for the bug this module exists to
  // fix: the V2 planner (activityAnalysisV2Service.ts) and the prep stage
  // (interpretationArtifactService.ts) both call renderClarificationQuestion
  // with the same shape of input for a shared code — they must never
  // diverge in wording again.
  const sharedInput = baseInput({
    questionCode: "row_grain",
    targetTableName: "sessions",
    language: "de",
  });

  const fromPrepStage = renderClarificationQuestion(sharedInput);
  const fromV2Replan = renderClarificationQuestion(sharedInput);

  assert.deepEqual(fromPrepStage, fromV2Replan);
});

test("questionCode null (the one documented open-ended exception) sanitizes internal IDs and UUIDs", () => {
  const rendered = renderClarificationQuestion(
    baseInput({
      questionCode: null,
      rawPrompt:
        "What does indicator 'X' mean, goalId: 3fa85f64-5717-4562-b3fc-2c963f66afa6?",
      rawOptions: [
        "Option A, uploadMetadataId: 3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "Option B",
      ],
    }),
  );
  assert.doesNotMatch(rendered.userFacingPrompt, /goalId|uploadMetadataId/i);
  assert.doesNotMatch(
    rendered.userFacingPrompt,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  assert.deepEqual(rendered.userFacingOptions, [
    { value: "Option A", label: "Option A" },
    { value: "Option B", label: "Option B" },
  ]);
});
