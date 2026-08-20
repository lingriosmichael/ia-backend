import assert from "node:assert/strict";
import test from "node:test";
import {
  isStructuralIdentifierColumnName,
  shouldIgnoreInterpretationQuestion,
} from "./interpretationQuestionFilters.js";

test("structural identifier epistemic-role questions are ignored", () => {
  assert.equal(isStructuralIdentifierColumnName("vorname"), true);
  assert.equal(isStructuralIdentifierColumnName("nachname"), true);
  assert.equal(isStructuralIdentifierColumnName("anmeldung_vorname"), true);
  assert.equal(isStructuralIdentifierColumnName("first_name"), true);
  assert.equal(isStructuralIdentifierColumnName("phone_number"), true);

  assert.equal(
    shouldIgnoreInterpretationQuestion(
      {
        questionCode: "epistemic_role_clarification",
        targetColumnName: "vorname",
      },
      null,
    ),
    true,
  );
});

test("deterministically resolved epistemic-role questions are ignored", () => {
  assert.equal(
    shouldIgnoreInterpretationQuestion(
      {
        questionCode: "epistemic_role_clarification",
        targetTableName: "baseline",
        targetColumnName: "befragung_typ",
      },
      {
        datasetProfile: {
          tableCount: 1,
          paragraphCount: 0,
          tables: [
            {
              name: "baseline",
              rowCount: 5,
              columnCount: 1,
              likelyIdentifierColumns: [],
              likelyStatusColumns: [],
              likelyStageColumns: [],
              likelyDateColumns: [],
              likelyMeasureColumns: [],
              likelyFreeTextColumns: [],
              likelySubgroupColumns: [],
              columns: [
                {
                  name: "befragung_typ",
                  inferredType: "categorical",
                  roleHints: [],
                  nullPercentage: 0,
                  distinctCount: 1,
                  averageTextLength: 10,
                  topValues: [{ value: "baseline", count: 5 }],
                  numericSummary: null,
                  dateSummary: null,
                  duplicateNonNullValueCount: 4,
                  epistemicRole: "constant",
                  isValidatedScaleCandidate: false,
                },
              ],
            },
          ],
          issues: [],
        },
      },
    ),
    true,
  );
});

test("constant columns in the current payload suppress stale epistemic-role questions", () => {
  assert.equal(
    shouldIgnoreInterpretationQuestion(
      {
        questionCode: "epistemic_role_clarification",
        targetTableName: "baseline",
        targetColumnName: "befragung_typ",
      },
      {
        datasetProfile: null,
        privacySafePayload: {
          tables: [
            {
              name: "baseline",
              rows: Array.from({ length: 5 }, () => ({
                befragung_typ: "baseline",
              })),
            },
          ],
        },
      },
    ),
    true,
  );
});

test("non-identifier epistemic-role questions are preserved", () => {
  assert.equal(isStructuralIdentifierColumnName("programmname"), false);
  assert.equal(isStructuralIdentifierColumnName("bezirk"), false);

  assert.equal(
    shouldIgnoreInterpretationQuestion(
      {
        questionCode: "epistemic_role_clarification",
        targetColumnName: "bezirk",
      },
      null,
    ),
    false,
  );
});
