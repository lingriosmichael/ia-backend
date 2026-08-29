import type {
  ClarificationQuestionOption,
  InterpretationQuestionCode,
} from "../../shared/contracts.js";

// Single backend-owned source of truth for clarification-question wording.
// See CLARIFICATION_QUESTION_WORDING_PLAN.md at the workspace root for the
// full design and the "Wording authorship rule" this module implements:
//
// 1. Every non-null InterpretationQuestionCode is rendered here, from
//    structured data only (ia_python_service must never author final
//    prompt/option text for these — it emits questionCode + target
//    table/column + questionData).
// 2. questionCode === null (ia_python_service's generate_clarification_questions
//    output) is the one permanent, documented exception — the only place an
//    LLM's own sentence/option text reaches a user, and it is sanitized
//    here, not by the frontend or by Python.
//
// Every prompt/option string below is a verbatim port of the matching
// bilingual template previously owned by
// ia_python_service/app/processing/interpretation_pipeline.py (or, for
// cohort_tag, ia_backend's own previous COHORT_TAG_QUESTION_TEMPLATES) —
// copied character for character, not re-translated, so this refactor
// introduces zero wording drift.

export type ClarificationQuestionLanguage = "de" | "en";

export interface ClarificationQuestionRenderInput {
  questionCode: InterpretationQuestionCode | null;
  targetTableName: string | null;
  targetColumnName: string | null;
  language: ClarificationQuestionLanguage;
  // Per-code structured substitution data (e.g. positive_status_values'
  // observed values, normalization_merge's validated variant groups).
  // Never prose. Codes that only need table/column name leave this null.
  questionData: Record<string, unknown> | null;
  // Only consulted when questionCode is null (the one documented
  // open-ended exception) — the raw LLM-authored text from
  // generate_clarification_questions.
  rawPrompt: string;
  rawOptions: string[] | null;
}

export interface ClarificationQuestionRenderOutput {
  userFacingPrompt: string;
  userFacingOptions: ClarificationQuestionOption[] | null;
}

function localized<T>(
  byLanguage: Record<ClarificationQuestionLanguage, T>,
  language: ClarificationQuestionLanguage,
): T {
  return byLanguage[language] ?? byLanguage.en;
}

function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

function toIdentityOptions(
  values: readonly string[],
): ClarificationQuestionOption[] {
  return values.map((value) => ({ value, label: value }));
}

function toIdentityOptionsOrNull(
  values: readonly string[],
): ClarificationQuestionOption[] | null {
  return values.length > 0 ? toIdentityOptions(values) : null;
}

function readStringArray(
  questionData: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = questionData?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// Matches ia_python_service's `", ".join(f"'{value}'" for value in values)`
// used to build the {values}/{variants} substitution text.
function quotedJoin(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

// ---- Sanitizer for the one documented open-ended exception ----
//
// Verbatim port of the regex previously duplicated in
// ia_python_service/app/activity_analyst_v2/analyst.py,
// ia_python_service/app/processing/interpretation_pipeline.py (both as
// `_sanitize_user_facing_question_text`), and
// ia_webapp/src/components/interpretationQuestionCard.tsx (as
// `sanitizeClarificationPrompt`). This is now the single canonical copy —
// see CLARIFICATION_QUESTION_WORDING_PLAN.md Phase 1/4.

const INTERNAL_ID_SEGMENT_PATTERN =
  /,?\s*(?:uploadMetadataId|metadataId|goalId)\s*[:=]\s*["']?[0-9a-f-]{8,}["']?/gi;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function sanitizeOpenEndedText(text: string): string {
  return text
    .replace(INTERNAL_ID_SEGMENT_PATTERN, "")
    .replace(UUID_PATTERN, "")
    .replace(/\(\s*,?\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function renderOpenEndedClarificationQuestion(
  rawPrompt: string,
  rawOptions: string[] | null,
): ClarificationQuestionRenderOutput {
  const sanitizedOptions = (rawOptions ?? [])
    .map((option) => sanitizeOpenEndedText(option))
    .filter((option) => option.length > 0);

  return {
    userFacingPrompt: sanitizeOpenEndedText(rawPrompt),
    userFacingOptions:
      sanitizedOptions.length > 0 ? toIdentityOptions(sanitizedOptions) : null,
  };
}

// ---- Per-code templates (verbatim ports — see file header) ----

const NORMALIZATION_MERGE_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de: "Bedeuten diese Werte in der Spalte '{field}' dasselbe: {variants}?",
  en: "Do these values in the column '{field}' mean the same thing: {variants}?",
};
const NORMALIZATION_MERGE_OPTIONS: Record<
  ClarificationQuestionLanguage,
  string[]
> = {
  de: ["Ja, das ist dasselbe", "Nein, das ist unterschiedlich"],
  en: ["Yes, they mean the same thing", "No, they mean different things"],
};

const ROW_GRAIN_PROMPT: Record<ClarificationQuestionLanguage, string> = {
  de: "Wofür steht eine Zeile in der Tabelle '{table}'?",
  en: "What does one row in the table '{table}' stand for?",
};

const ROW_GRAIN_DUPLICATE_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de:
    "In der Tabelle '{table}' kommt derselbe Wert in '{field}' mehrfach vor. " +
    "Sind das mehrere Einträge zur selben Person oder zum selben Fall, " +
    "oder sind es doppelte Zeilen?",
  en:
    "In the table '{table}', the same value appears more than once in " +
    "'{field}'. Are these multiple entries for the same person or case, " +
    "or duplicate rows?",
};
const ROW_GRAIN_DUPLICATE_OPTIONS: Record<
  ClarificationQuestionLanguage,
  string[]
> = {
  de: [
    "Mehrere Einträge zur selben Person / zum selben Fall",
    "Doppelte Zeilen, nur einmal zählen",
    "Ich bin unsicher",
  ],
  en: [
    "Multiple entries for the same person / case",
    "Duplicate rows, count once",
    "I am not sure",
  ],
};

const STATUS_MEANING_PROMPT: Record<ClarificationQuestionLanguage, string> = {
  de:
    "Welche Werte in der Spalte '{field}' sollen als erfolgreicher " +
    "oder positiver Status gelten? Wählen Sie alles aus, was zählt. " +
    "Gefundene Werte: {values}.",
  en:
    "Which values in the column '{field}' should count as a successful " +
    "or positive status? Select every value that should count. " +
    "Found values: {values}.",
};

const STATUS_FIELD_SELECTION_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de:
    "Welche Spalte in der Tabelle '{table}' zeigt am besten, ob etwas " +
    "erfolgreich war oder nicht?",
  en:
    "Which column in the table '{table}' best shows whether something " +
    "was successful or not?",
};

const DATE_FIELD_SELECTION_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de:
    "Welche Datumsspalte in der Tabelle '{table}' zeigt am besten, " +
    "wann etwas passiert ist?",
  en: "Which date column in the table '{table}' best shows when something happened?",
};

const EPISTEMIC_ROLE_CLARIFICATION_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de: "Welche Art von Antworten steht in der Spalte '{column}'?",
  en: "What kind of answers are in the column '{column}'?",
};
const EPISTEMIC_ROLE_CLARIFICATION_OPTIONS: Record<
  ClarificationQuestionLanguage,
  string[]
> = {
  de: [
    "Feste Auswahl oder Kategorien",
    "Freie Antworten in Textform",
    "Kurze Bewertung oder Einschätzung",
    "Etwas anderes",
  ],
  en: [
    "Fixed choices or categories",
    "Free-text answers",
    "A short rating or judgement",
    "Something else",
  ],
};

// Not shown in the primary UI: cohort_tag is answered by dragging files
// into named groups (InterpretationCohortGroupingBoard in ia_webapp), which
// uses its own instruction copy, not this prompt. Kept as a required field
// on the question record itself (for any other consumer/API view), so this
// describes the underlying question in general terms rather than the old
// single-file free-text mechanism (with its now-inapplicable "not
// applicable" escape hatch) that the grouping board replaced.
const COHORT_TAG_PROMPT: Record<ClarificationQuestionLanguage, string> = {
  de:
    `Welche Zielgruppe betrifft die Tabelle '{table}'? Das hilft dabei, nur ` +
    `passende Ausgangslage- und Wirkungsdaten miteinander zu vergleichen.`,
  en:
    `Which cohort does the table '{table}' concern? This helps compare only ` +
    `the right baseline and endline data with each other.`,
};

// New (Phase 5): the Stage-9 filter-value-grounding question. Unlike the
// codes above, this one has no prior Python template to port from — it
// replaces a fully open-ended LLM ask. Options are always the column's
// real observedValues, never invented text.
const FILTER_VALUE_GROUNDING_PROMPT: Record<
  ClarificationQuestionLanguage,
  string
> = {
  de:
    "Welche Werte in der Spalte '{column}' entsprechen der Bedingung, die " +
    "für diese Auswertung gemeint ist? Wählen Sie alle passenden Werte aus.",
  en:
    "Which values in the column '{column}' match the condition this " +
    "analysis needs? Select every value that applies.",
};

// ---- Renderers ----

type ClarificationQuestionRenderer = (
  input: ClarificationQuestionRenderInput,
) => ClarificationQuestionRenderOutput;

function renderNormalizationMerge(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  const variants = readStringArray(input.questionData, "variants");
  return {
    userFacingPrompt: fillTemplate(
      localized(NORMALIZATION_MERGE_PROMPT, input.language),
      {
        field: input.targetColumnName ?? "",
        variants: quotedJoin(variants),
      },
    ),
    userFacingOptions: toIdentityOptions(
      localized(NORMALIZATION_MERGE_OPTIONS, input.language),
    ),
  };
}

function renderRowGrain(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  return {
    userFacingPrompt: fillTemplate(
      localized(ROW_GRAIN_PROMPT, input.language),
      {
        table: input.targetTableName ?? "",
      },
    ),
    userFacingOptions: null,
  };
}

function renderDuplicateIdentifierResolution(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  return {
    userFacingPrompt: fillTemplate(
      localized(ROW_GRAIN_DUPLICATE_PROMPT, input.language),
      {
        table: input.targetTableName ?? "",
        field: input.targetColumnName ?? "",
      },
    ),
    userFacingOptions: toIdentityOptions(
      localized(ROW_GRAIN_DUPLICATE_OPTIONS, input.language),
    ),
  };
}

// Options are the real candidate column names for this table
// (table.likelyStatusColumns in interpretation_pipeline.py) — dynamic,
// data-derived, not a fixed template. Rendered as identity options since a
// column name is already safe, real data, never invented text.
function renderPrimaryStatusField(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  const candidateColumnNames = readStringArray(
    input.questionData,
    "candidateColumnNames",
  );
  return {
    userFacingPrompt: fillTemplate(
      localized(STATUS_FIELD_SELECTION_PROMPT, input.language),
      {
        table: input.targetTableName ?? "",
      },
    ),
    userFacingOptions: toIdentityOptionsOrNull(candidateColumnNames),
  };
}

// Options are the column's real observed status values — also used to
// build the {values} substitution text in the prompt itself, exactly as
// interpretation_pipeline.py's status_meaning_template did.
function renderPositiveStatusValues(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  const observedStatusValues = readStringArray(
    input.questionData,
    "observedStatusValues",
  );
  return {
    userFacingPrompt: fillTemplate(
      localized(STATUS_MEANING_PROMPT, input.language),
      {
        field: input.targetColumnName ?? "",
        values: quotedJoin(observedStatusValues),
      },
    ),
    userFacingOptions: toIdentityOptionsOrNull(observedStatusValues),
  };
}

// Options are the real candidate date column names for this table
// (table.likelyDateColumns) — same rationale as primary_status_field above.
function renderPrimaryDateField(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  const candidateColumnNames = readStringArray(
    input.questionData,
    "candidateColumnNames",
  );
  return {
    userFacingPrompt: fillTemplate(
      localized(DATE_FIELD_SELECTION_PROMPT, input.language),
      {
        table: input.targetTableName ?? "",
      },
    ),
    userFacingOptions: toIdentityOptionsOrNull(candidateColumnNames),
  };
}

function renderEpistemicRoleClarification(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  return {
    userFacingPrompt: fillTemplate(
      localized(EPISTEMIC_ROLE_CLARIFICATION_PROMPT, input.language),
      { column: input.targetColumnName ?? "" },
    ),
    userFacingOptions: toIdentityOptions(
      localized(EPISTEMIC_ROLE_CLARIFICATION_OPTIONS, input.language),
    ),
  };
}

function renderCohortTag(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  return {
    userFacingPrompt: fillTemplate(
      localized(COHORT_TAG_PROMPT, input.language),
      {
        table: input.targetTableName ?? "",
      },
    ),
    userFacingOptions: null,
  };
}

// Options are the column's real observedValues — never an invented value,
// matching the Stage-9 grounding invariant this code exists to enforce.
function renderFilterValueGrounding(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  const observedValues = readStringArray(input.questionData, "observedValues");
  return {
    userFacingPrompt: fillTemplate(
      localized(FILTER_VALUE_GROUNDING_PROMPT, input.language),
      {
        column: input.targetColumnName ?? "",
      },
    ),
    userFacingOptions: toIdentityOptionsOrNull(observedValues),
  };
}

// Record<InterpretationQuestionCode, ...> gives a compile-time
// exhaustiveness check — adding a 14th questionCode to contracts.ts without
// a matching renderer here is a type error, not a silent runtime gap.
const RENDERERS: Record<
  InterpretationQuestionCode,
  ClarificationQuestionRenderer
> = {
  normalization_merge: renderNormalizationMerge,
  row_grain: renderRowGrain,
  duplicate_identifier_resolution: renderDuplicateIdentifierResolution,
  primary_status_field: renderPrimaryStatusField,
  positive_status_values: renderPositiveStatusValues,
  primary_date_field: renderPrimaryDateField,
  epistemic_role_clarification: renderEpistemicRoleClarification,
  cohort_tag: renderCohortTag,
  filter_value_grounding: renderFilterValueGrounding,
};

export function renderClarificationQuestion(
  input: ClarificationQuestionRenderInput,
): ClarificationQuestionRenderOutput {
  if (input.questionCode === null) {
    return renderOpenEndedClarificationQuestion(
      input.rawPrompt,
      input.rawOptions,
    );
  }
  return RENDERERS[input.questionCode](input);
}
