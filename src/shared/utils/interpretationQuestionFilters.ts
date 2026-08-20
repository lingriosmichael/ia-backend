import type {
  DatasetProfile,
  DatasetProfileColumn,
  InterpretationQuestionCode,
  InterpretationQuestionKind,
} from "../contracts.js";

type FilterableInterpretationQuestion = {
  kind?: InterpretationQuestionKind | null;
  questionCode?: InterpretationQuestionCode | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
};

type InterpretationQuestionFilterContext = {
  datasetProfile?: DatasetProfile | null;
  privacySafePayload?: Record<string, unknown> | null;
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
  context?: InterpretationQuestionFilterContext | null,
) {
  if (question.questionCode === "epistemic_role_clarification") {
    const profileColumn = findProfileColumnForQuestion(
      question,
      context?.datasetProfile,
    );
    if (profileColumn?.epistemicRole) {
      return true;
    }
    if (isConstantColumnInPayload(question, context?.privacySafePayload)) {
      return true;
    }
  }

  return (
    question.questionCode === "epistemic_role_clarification" &&
    isStructuralIdentifierColumnName(question.targetColumnName)
  );
}

function findProfileColumnForQuestion(
  question: Pick<
    FilterableInterpretationQuestion,
    "questionCode" | "targetTableName" | "targetColumnName"
  >,
  datasetProfile?: DatasetProfile | null,
): DatasetProfileColumn | null {
  if (
    question.questionCode !== "epistemic_role_clarification" ||
    !question.targetTableName ||
    !question.targetColumnName
  ) {
    return null;
  }

  const table =
    datasetProfile?.tables.find(
      (candidate) => candidate.name === question.targetTableName,
    ) ?? null;
  if (!table) {
    return null;
  }

  return (
    table.columns.find((column) => column.name === question.targetColumnName) ??
    null
  );
}

function isConstantColumnInPayload(
  question: Pick<
    FilterableInterpretationQuestion,
    "questionCode" | "targetTableName" | "targetColumnName"
  >,
  privacySafePayload?: Record<string, unknown> | null,
) {
  if (
    question.questionCode !== "epistemic_role_clarification" ||
    !question.targetTableName ||
    !question.targetColumnName
  ) {
    return false;
  }

  const tables = Array.isArray(privacySafePayload?.tables)
    ? privacySafePayload.tables
    : [];
  const table = tables.find(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      candidate.name === question.targetTableName,
  );
  if (!table || !Array.isArray(table.rows)) {
    return false;
  }

  const distinctValues = new Set<string>();
  for (const row of table.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const rawValue = (row as Record<string, unknown>)[
      question.targetColumnName
    ];
    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    const normalizedValue =
      typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
    if (!normalizedValue) {
      continue;
    }
    distinctValues.add(normalizedValue);
    if (distinctValues.size > 1) {
      return false;
    }
  }

  return distinctValues.size === 1;
}
