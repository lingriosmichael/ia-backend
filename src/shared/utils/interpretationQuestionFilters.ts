import type {
  InterpretationQuestionCode,
  InterpretationQuestionKind,
} from "../contracts.js";

type FilterableInterpretationQuestion = {
  kind?: InterpretationQuestionKind | null;
  questionCode?: InterpretationQuestionCode | null;
  targetColumnName?: string | null;
};

const STRUCTURAL_IDENTIFIER_COLUMN_NAMES = new Set([
  "vorname",
  "nachname",
  "familienname",
  "vollname",
  "geburtsname",
  "first_name",
  "last_name",
  "full_name",
  "participant_name",
  "email",
  "mail",
  "telefon",
  "telefonnummer",
  "phone",
  "phone_number",
]);

function normalizeColumnName(columnName: string) {
  return columnName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isStructuralIdentifierColumnName(
  columnName: string | null | undefined,
) {
  if (!columnName) {
    return false;
  }

  const normalized = normalizeColumnName(columnName);
  if (STRUCTURAL_IDENTIFIER_COLUMN_NAMES.has(normalized)) {
    return true;
  }

  return Array.from(STRUCTURAL_IDENTIFIER_COLUMN_NAMES).some(
    (identifierName) =>
      normalized.startsWith(`${identifierName}_`) ||
      normalized.endsWith(`_${identifierName}`),
  );
}

export function shouldIgnoreInterpretationQuestion(
  question: FilterableInterpretationQuestion,
) {
  return (
    question.questionCode === "epistemic_role_clarification" &&
    isStructuralIdentifierColumnName(question.targetColumnName)
  );
}
