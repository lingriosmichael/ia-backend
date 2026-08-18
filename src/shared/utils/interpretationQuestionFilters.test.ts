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
    shouldIgnoreInterpretationQuestion({
      questionCode: "epistemic_role_clarification",
      targetColumnName: "vorname",
    }),
    true,
  );
});

test("non-identifier epistemic-role questions are preserved", () => {
  assert.equal(isStructuralIdentifierColumnName("programmname"), false);
  assert.equal(isStructuralIdentifierColumnName("bezirk"), false);

  assert.equal(
    shouldIgnoreInterpretationQuestion({
      questionCode: "epistemic_role_clarification",
      targetColumnName: "bezirk",
    }),
    false,
  );
});
