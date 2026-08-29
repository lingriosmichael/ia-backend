import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfileTable,
  DatasetPreparationDecisionSelection,
  DatasetPreparationDecisionSummary,
  DatasetPreparationStatus,
  EpistemicRole,
  EvidenceModality,
  InterpretationQuestionCode,
  PreparedDatasetColumnRole,
  PreparedDatasetIdentifierHandling,
  PreparedDatasetMetricKind,
  PreparedDatasetSnapshot,
  PreparedDatasetTable,
  PreparedDatasetValueScope,
} from "../../shared/contracts.js";
import { classifyEvidenceModalityFromPayload } from "../../shared/utils/evidenceModality.js";
import { shouldIgnoreInterpretationQuestion } from "../../shared/utils/interpretationQuestionFilters.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import type {
  DatasetPreparationPersistenceRecord,
  DatasetPreparationUpsertInput,
} from "./datasetPreparationPersistence.js";
import type { InterpretationResultPersistenceRecord } from "./interpretationResultPersistence.js";

// Exported so interpretationReviewState.ts's
// FIRST_LAYER_BLOCKING_QUESTION_CODES can share this exact set instead of
// maintaining an independent copy — the two used to be separately
// maintained identical literals, risking one getting a new code added
// without the other.
export const PREPARATION_QUESTION_CODES = new Set<InterpretationQuestionCode>([
  "normalization_merge",
  "row_grain",
  "duplicate_identifier_resolution",
  "epistemic_role_clarification",
  "cohort_tag",
]);

function isPreparationQuestionCode(
  value: InterpretationQuestionCode | null,
): value is InterpretationQuestionCode {
  return Boolean(value && PREPARATION_QUESTION_CODES.has(value));
}

function isPreparationQuestion(
  question: InterpretationResultPersistenceRecord["questions"][number],
  datasetProfile: InterpretationResultPersistenceRecord["datasetProfile"],
  privacySafePayload: Record<string, unknown>,
): boolean {
  // A stale epistemic_role_clarification question on a structural
  // identifier column (e.g. 'vorname') is ignored elsewhere as
  // non-blocking and hidden from the API (see
  // shouldIgnoreInterpretationQuestion) — it must be excluded here too,
  // otherwise it stays an unanswerable, permanently pending preparation
  // requirement and dataset preparation can never reach
  // "ready_for_analysis" even though nothing surfaces that to the user.
  if (
    shouldIgnoreInterpretationQuestion(question, {
      datasetProfile,
      privacySafePayload,
    })
  ) {
    return false;
  }

  return (
    question.questionDomain === "preparation" &&
    question.isBlocking &&
    isPreparationQuestionCode(question.questionCode)
  );
}

// Explicit return type (rather than relying on inference) so this object's
// keys are checked against DatasetPreparationDecisionSummary at compile
// time — adding a field to one without the other now fails the build
// instead of silently drifting apart, per CLAUDE.md's "update the model
// and any contract mapper in the same change" rule.
function emptyDecisionSummary(): DatasetPreparationDecisionSummary {
  return {
    normalizationMerges: [] as DatasetPreparationDecisionSelection[],
    rowGrains: [] as DatasetPreparationDecisionSelection[],
    duplicateIdentifierResolutions: [] as DatasetPreparationDecisionSelection[],
    // primaryStatusFields/positiveStatusDefinitions are structurally always
    // empty: their source question codes (primary_status_field,
    // positive_status_values) are deferred to ActivityAnalysisV2's
    // activity-scoped clarification mechanism and stripped before
    // persistence (see DEFERRED_TO_ACTIVITY_ANALYSIS_V2_QUESTION_CODES in
    // interpretationArtifactService.ts), so no question with either code
    // ever reaches mapQuestionCodeToSummaryKey below to populate these.
    // primaryStatusColumn selection still works via the likelyStatusColumns
    // heuristic fallback further down this file when there's exactly one
    // candidate; it's only the explicit-answer override path (needed to
    // disambiguate when there's more than one candidate) that's dead. See
    // countPositiveRows in deterministicAnalysisService.ts for the
    // downstream effect.
    primaryStatusFields: [] as DatasetPreparationDecisionSelection[],
    positiveStatusDefinitions: [] as DatasetPreparationDecisionSelection[],
    primaryDateFields: [] as DatasetPreparationDecisionSelection[],
    epistemicRoleClarifications: [] as DatasetPreparationDecisionSelection[],
    cohortTags: [] as DatasetPreparationDecisionSelection[],
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function mapQuestionCodeToSummaryKey(questionCode: InterpretationQuestionCode) {
  switch (questionCode) {
    case "normalization_merge":
      return "normalizationMerges";
    case "row_grain":
      return "rowGrains";
    case "duplicate_identifier_resolution":
      return "duplicateIdentifierResolutions";
    case "primary_status_field":
      return "primaryStatusFields";
    case "positive_status_values":
      return "positiveStatusDefinitions";
    case "primary_date_field":
      return "primaryDateFields";
    case "epistemic_role_clarification":
      return "epistemicRoleClarifications";
    case "cohort_tag":
      return "cohortTags";
  }
}

function matchSelectionByTable(
  selections: DatasetPreparationDecisionSelection[],
  tableName: string,
): DatasetPreparationDecisionSelection | null {
  return (
    selections.find((selection) => selection.tableName === tableName) ?? null
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeColumnName(value: string): string {
  return value.trim().toLowerCase();
}

function columnNameIncludesCue(
  value: string,
  cues: readonly string[],
): boolean {
  const normalized = normalizeColumnName(value);
  return cues.some((cue) => normalized.includes(cue));
}

const RATIO_COLUMN_CUES = [
  "prozent",
  "percent",
  "quote",
  "ratio",
  "rate",
  "anteil",
] as const;
const DURATION_COLUMN_CUES = [
  "dauer",
  "duration",
  "minute",
  "minuten",
  "hour",
  "hours",
  "stunde",
  "stunden",
  "day",
  "days",
  "tag",
  "tage",
] as const;
const AMOUNT_COLUMN_CUES = [
  "betrag",
  "amount",
  "cost",
  "kosten",
  "budget",
  "preis",
  "price",
  "euro",
  "eur",
] as const;
const TABLE_AGGREGATE_SCOPE_CUES = [
  "gesamt",
  "total",
  "overall",
  "kumul",
  "cumulative",
  "bisher",
  "year_to_date",
  "ytd",
  "zielwert",
  "expected",
  "erwartet",
  "planned",
  "geplant",
  "mindest",
  "maximum",
  "minimum",
] as const;

function inferPreparedColumnMetricKind(input: {
  columnName: string;
  inferredType: string | null;
  epistemicRole: EpistemicRole | null;
  distinctCount: number | null;
  minValue: number | null;
  maxValue: number | null;
}): PreparedDatasetMetricKind | null {
  if (input.epistemicRole === "validated_scale") {
    return "score";
  }
  if (input.epistemicRole === "flag" || input.inferredType === "boolean") {
    return "flag";
  }
  if (input.inferredType !== "numeric") {
    return null;
  }
  if (columnNameIncludesCue(input.columnName, RATIO_COLUMN_CUES)) {
    return "ratio";
  }
  if (columnNameIncludesCue(input.columnName, DURATION_COLUMN_CUES)) {
    return "duration";
  }
  if (columnNameIncludesCue(input.columnName, AMOUNT_COLUMN_CUES)) {
    return "amount";
  }
  if (
    input.minValue !== null &&
    input.maxValue !== null &&
    input.minValue >= 0 &&
    input.maxValue <= 1 &&
    (input.distinctCount ?? 0) > 2
  ) {
    return "ratio";
  }
  return "count";
}

function inferPreparedColumnValueScope(input: {
  columnName: string;
  role: PreparedDatasetColumnRole;
  metricKind: PreparedDatasetMetricKind | null;
  rowCount: number;
  distinctCount: number | null;
  minValue: number | null;
  inferredGoalSupportType: "output" | null;
}): PreparedDatasetValueScope | null {
  if (input.inferredGoalSupportType) {
    return "goal_support";
  }
  if (input.role === "identifier") {
    return "entity";
  }
  if (input.metricKind === null) {
    return null;
  }
  if (input.metricKind === "flag") {
    return "row";
  }
  if (columnNameIncludesCue(input.columnName, TABLE_AGGREGATE_SCOPE_CUES)) {
    return "table_aggregate";
  }
  if (
    input.metricKind === "count" &&
    input.rowCount > 1 &&
    input.distinctCount === 1 &&
    (input.minValue ?? 0) > 1
  ) {
    return "table_aggregate";
  }
  return "row";
}

function inferGoalSupportType(columnName: string): "output" | null {
  const normalized = normalizeColumnName(columnName);
  if (normalized.startsWith("ziel_output_")) {
    return "output";
  }
  return null;
}

function parseIdentifierHandling(
  selection: DatasetPreparationDecisionSelection | null,
): PreparedDatasetIdentifierHandling | null {
  if (!selection) {
    return null;
  }
  const answer = normalizeText(selection.value);
  if (
    answer.includes("multiple events") ||
    answer.includes("interactions") ||
    answer.includes("mehrere ereignisse") ||
    answer.includes("mehrere einträge")
  ) {
    return "allow_duplicate_rows_as_events";
  }
  if (
    answer.includes("count once") ||
    answer.includes("duplicates") ||
    answer.includes("dubletten") ||
    answer.includes("nur einmal")
  ) {
    return "deduplicate_by_identifier";
  }
  if (
    answer.includes("manual review") ||
    answer.includes("manuell") ||
    answer.includes("needs review")
  ) {
    return "manual_review_required";
  }
  return null;
}

// Matches the fixed option text Python emits for "epistemic_role_clarification"
// (interpretation_pipeline.py's _EPISTEMIC_ROLE_CLARIFICATION_OPTIONS) — a
// closed single-choice answer set, not open-ended user typing, so keyword
// matching here is exact rather than fuzzy.
function parseEpistemicRoleClarificationAnswer(
  answer: string | null,
): EpistemicRole | null {
  if (!answer) {
    return null;
  }
  const normalized = normalizeText(answer);
  if (
    normalized.includes("person's judgement") ||
    normalized.includes("einschätzung durch eine person") ||
    normalized.includes("short rating") ||
    normalized.includes("kurze bewertung") ||
    normalized.includes("einschätzung") ||
    normalized.includes("reviewer") ||
    normalized.includes("prüfende")
  ) {
    return "subjective_code";
  }
  if (
    normalized.includes("free text") ||
    normalized.includes("freie texte") ||
    normalized.includes("free-text answers") ||
    normalized.includes("freie antworten") ||
    normalized.includes("quote") ||
    normalized.includes("comment") ||
    normalized.includes("zitat") ||
    normalized.includes("kommentar")
  ) {
    return "free_text";
  }
  if (
    normalized.includes("fixed choice values") ||
    normalized.includes("feste auswahlwerte") ||
    normalized.includes("fixed choices") ||
    normalized.includes("feste auswahl") ||
    normalized.includes("kategorien") ||
    normalized.includes("something else") ||
    normalized.includes("etwas anderes") ||
    normalized.includes("plain descriptive") ||
    normalized.includes("normales datenfeld")
  ) {
    return "categorical";
  }
  return null;
}

// The cohort_tag question's option list is generated per-project from
// Project.targetGroups plus a leading "not applicable / single cohort"
// option (unlike the other closed-option questions above, its wording isn't
// a fixed Python-side vocabulary) — so the parser only needs to recognize
// that leading option and otherwise trust the selected project-declared
// label verbatim.
const COHORT_TAG_NOT_APPLICABLE_MARKERS = [
  "not applicable",
  "n/a",
  "single cohort",
  "nicht zutreffend",
  "keine kohorte",
];

function parseCohortTagAnswer(answer: string | null): string | null {
  if (!answer) {
    return null;
  }
  const trimmed = answer.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeText(trimmed);
  if (
    COHORT_TAG_NOT_APPLICABLE_MARKERS.some((marker) =>
      normalized.includes(marker),
    )
  ) {
    return null;
  }
  return trimmed;
}

function parsePositiveStatusValues(
  answer: string | null,
  observedValues: string[],
): string[] {
  if (!answer) {
    return [];
  }
  const normalizedAnswer = normalizeText(answer);
  if (normalizedAnswer === "alle" || normalizedAnswer === "all") {
    return observedValues;
  }
  const exactTokens = new Set(
    answer
      .split(/[,;\n]/)
      .map((token) => normalizeText(token))
      .filter(Boolean),
  );
  return observedValues.filter((value) => {
    const normalizedValue = normalizeText(value);
    return (
      normalizedAnswer.includes(normalizedValue) ||
      exactTokens.has(normalizedValue)
    );
  });
}

function buildPreparedDatasetSnapshot(
  evidenceModality: EvidenceModality,
  result: InterpretationResultPersistenceRecord,
  privacySafePayload: Record<string, unknown>,
  decisionSummary: ReturnType<typeof emptyDecisionSummary>,
): PreparedDatasetSnapshot | null {
  if (
    evidenceModality !== "structured_quantitative" &&
    evidenceModality !== "mixed_dual_track"
  ) {
    return null;
  }

  const payloadTables = Array.isArray(privacySafePayload.tables)
    ? privacySafePayload.tables.filter(
        (table): table is Record<string, unknown> =>
          Boolean(table) && typeof table === "object" && !Array.isArray(table),
      )
    : [];
  const profileTablesByName = new Map(
    (result.datasetProfile?.tables ?? []).map((table) => [table.name, table]),
  );
  const preparedTables: PreparedDatasetTable[] = [];
  const unresolvedRequirements: string[] = [];

  for (const payloadTable of payloadTables) {
    const tableName =
      typeof payloadTable.name === "string" ? payloadTable.name : "table";
    const profileTable: DatasetProfileTable | null =
      profileTablesByName.get(tableName) ?? null;
    const payloadColumns = readStringArray(payloadTable.columns);
    const rowCount =
      typeof payloadTable.rowCount === "number"
        ? payloadTable.rowCount
        : (profileTable?.rowCount ?? 0);

    const rowGrainSelection = matchSelectionByTable(
      decisionSummary.rowGrains,
      tableName,
    );
    const duplicateResolutionSelection = matchSelectionByTable(
      decisionSummary.duplicateIdentifierResolutions,
      tableName,
    );
    const primaryStatusSelection = matchSelectionByTable(
      decisionSummary.primaryStatusFields,
      tableName,
    );
    const primaryDateSelection = matchSelectionByTable(
      decisionSummary.primaryDateFields,
      tableName,
    );
    const cohortTagSelection = matchSelectionByTable(
      decisionSummary.cohortTags,
      tableName,
    );

    // A table can have more than one duplicate_identifier_resolution
    // question — one per likely-identifier column that actually has
    // duplicate values (e.g. both 'bewerbungs_id' and 'vorname' can be
    // likely-identifier candidates, but only 'vorname' has duplicates and
    // therefore only it gets a question). matchSelectionByTable only
    // matches by table name, not by column, so a duplicate-resolution
    // answer must only be trusted to pick the identifier column when it's
    // actually about the top-ranked candidate — otherwise an answer about
    // a lower-ranked, duplicate-prone column would silently override an
    // already-unambiguous, higher-ranked one that never needed a question
    // at all. Confirmed against a real activity: 'vorname' (duplicate
    // first names) won over 'bewerbungs_id' (the real, unique id column)
    // purely because vorname's question happened to be the one answered,
    // which then broke evidence-linkage matching against a second upload
    // whose identifier column was correctly 'bewerbungs_id'.
    const identifierColumn = profileTable?.likelyIdentifierColumns[0] ?? null;
    const identifierResolutionAppliesToIdentifierColumn =
      identifierColumn !== null &&
      duplicateResolutionSelection?.columnName === identifierColumn;
    const identifierHandling =
      (identifierResolutionAppliesToIdentifierColumn
        ? parseIdentifierHandling(duplicateResolutionSelection)
        : null) ?? (identifierColumn ? "assume_unique" : null);
    const primaryStatusColumn =
      primaryStatusSelection?.value ??
      (profileTable?.likelyStatusColumns.length === 1
        ? (profileTable.likelyStatusColumns[0] ?? null)
        : null);
    const primaryDateColumn =
      primaryDateSelection?.value ??
      (profileTable?.likelyDateColumns.length === 1
        ? (profileTable.likelyDateColumns[0] ?? null)
        : null);
    const positiveStatusSelection = profileTable
      ? (decisionSummary.positiveStatusDefinitions.find(
          (selection) =>
            selection.tableName === tableName &&
            selection.columnName === primaryStatusColumn,
        ) ?? null)
      : null;

    const observedStatusValues =
      profileTable?.columns
        .find((column) => column.name === primaryStatusColumn)
        ?.topValues.map((entry) => entry.value) ?? [];
    const positiveStatusValues = parsePositiveStatusValues(
      positiveStatusSelection?.value ?? null,
      observedStatusValues,
    );

    if (
      primaryStatusColumn &&
      positiveStatusSelection &&
      positiveStatusValues.length === 0
    ) {
      unresolvedRequirements.push(
        `Positive status definition for '${primaryStatusColumn}' in '${tableName}' could not be grounded to observed values.`,
      );
    }
    if (identifierHandling === "manual_review_required") {
      unresolvedRequirements.push(
        `Identifier handling for '${tableName}' still requires manual review.`,
      );
    }

    const columns = payloadColumns.map((columnName) => {
      const profileColumn =
        profileTable?.columns.find((column) => column.name === columnName) ??
        null;
      const normalizationDecision = decisionSummary.normalizationMerges.find(
        (selection) => selection.columnName === columnName,
      );
      const normalizationAccepted = normalizationDecision
        ? normalizeText(normalizationDecision.value).startsWith("yes") ||
          normalizeText(normalizationDecision.value).startsWith("ja")
        : null;

      const role: PreparedDatasetColumnRole =
        columnName === identifierColumn
          ? "identifier"
          : columnName === primaryStatusColumn
            ? "primary_status"
            : columnName === primaryDateColumn
              ? "primary_date"
              : profileTable?.likelyMeasureColumns.includes(columnName)
                ? "measure"
                : profileTable?.likelySubgroupColumns.includes(columnName)
                  ? "subgroup"
                  : profileTable?.likelyFreeTextColumns.includes(columnName)
                    ? "free_text"
                    : "other";

      // Python can't fully resolve epistemicRole at profiling time: an
      // ambiguous string column (epistemicRole === null) needs a human
      // choice between subjective_code/free_text — ask rather than
      // silently default (Section 3 of QUALITATIVE_MIXED_EVIDENCE_PLAN.md).
      //
      // A validated_scale candidate used to also need an explicit human
      // confirmation (validated_scale_confirmation) before being upgraded
      // from the safe metric_count default, plus a declared pairing
      // identity/instrument bounds (pairing_group_key/pairing_group_role/
      // declared_scale_bounds) once confirmed. That whole mechanism was
      // removed in OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 6 — Python's
      // isValidatedScaleCandidate is always false now (see
      // interpretation_pipeline.py's _classify_epistemic_role), so
      // epistemicRole can no longer resolve to "validated_scale" for a
      // newly-interpreted column.
      const epistemicRoleClarificationAnswer =
        decisionSummary.epistemicRoleClarifications.find(
          (selection) =>
            selection.tableName === tableName &&
            selection.columnName === columnName,
        ) ?? null;
      const baseEpistemicRole: EpistemicRole | null =
        profileColumn?.epistemicRole ?? null;
      const epistemicRole: EpistemicRole | null =
        baseEpistemicRole === null
          ? parseEpistemicRoleClarificationAnswer(
              epistemicRoleClarificationAnswer?.value ?? null,
            )
          : baseEpistemicRole;

      const minValue = profileColumn?.numericSummary?.min ?? null;
      const maxValue = profileColumn?.numericSummary?.max ?? null;
      const metricKind = inferPreparedColumnMetricKind({
        columnName,
        inferredType: profileColumn?.inferredType ?? null,
        epistemicRole,
        distinctCount: profileColumn?.distinctCount ?? null,
        minValue,
        maxValue,
      });
      const valueScope = inferPreparedColumnValueScope({
        columnName,
        role,
        metricKind,
        rowCount,
        distinctCount: profileColumn?.distinctCount ?? null,
        minValue,
        inferredGoalSupportType: inferGoalSupportType(columnName),
      });

      return {
        name: columnName,
        inferredType: profileColumn?.inferredType ?? null,
        role,
        positiveStatusValues:
          columnName === primaryStatusColumn ? positiveStatusValues : [],
        positiveStatusDefinitionText:
          columnName === primaryStatusColumn
            ? (positiveStatusSelection?.value ?? null)
            : null,
        normalizationAccepted,
        epistemicRole,
        minValue,
        maxValue,
        metricKind,
        valueScope,
      };
    });

    const notes: string[] = [];
    if (rowGrainSelection?.value) {
      notes.push(`Row grain: ${rowGrainSelection.value}`);
    }
    if (positiveStatusSelection?.value && positiveStatusValues.length > 0) {
      notes.push(
        `Positive status values resolved as: ${positiveStatusValues.join(", ")}`,
      );
    }

    preparedTables.push({
      name: tableName,
      rowCount,
      columnCount: payloadColumns.length,
      selectedRowGrain: rowGrainSelection?.value ?? null,
      identifierColumn,
      identifierHandling,
      primaryStatusColumn,
      primaryDateColumn,
      columns,
      notes,
      cohortTag: parseCohortTagAnswer(cohortTagSelection?.value ?? null),
    });
  }

  return {
    evidenceModality,
    isReadyForDeterministicAnalysis: unresolvedRequirements.length === 0,
    unresolvedRequirements,
    tables: preparedTables,
  };
}

function buildPreparationInput(
  result: InterpretationResultPersistenceRecord,
  status: DatasetPreparationStatus,
  evidenceModality: EvidenceModality,
  privacySafePayload: Record<string, unknown>,
): DatasetPreparationUpsertInput {
  const preparationQuestions = result.questions.filter((question) =>
    isPreparationQuestion(question, result.datasetProfile, privacySafePayload),
  );
  const answeredQuestions = preparationQuestions.filter(
    (question) => question.status === "answered" && question.answeredValue,
  );

  const decisionSummary = emptyDecisionSummary();
  const decisions = answeredQuestions.map((question) => {
    const selection = {
      questionId: question.id,
      tableName: question.targetTableName ?? null,
      columnName: question.targetColumnName ?? null,
      value: question.answeredValue ?? "",
      groupId: question.preparationGroupId ?? null,
      groupColumns: question.preparationGroupColumns ?? null,
    };
    // mapQuestionCodeToSummaryKey only covers preparation-domain codes —
    // an interpretation-domain code (e.g. filter_value_grounding) has no
    // decisionSummary bucket and is safely skipped here rather than
    // indexed with an undefined key.
    const summaryKey = mapQuestionCodeToSummaryKey(question.questionCode!);
    if (summaryKey) {
      decisionSummary[summaryKey].push(selection);
    }

    return {
      questionId: question.id,
      questionCode: question.questionCode!,
      questionPrompt: question.userFacingPrompt,
      tableName: question.targetTableName ?? null,
      columnName: question.targetColumnName ?? null,
      answeredValue: question.answeredValue ?? "",
      answeredById: question.answeredById ?? null,
      answeredAt: question.answeredAt ?? null,
    };
  });

  const preparedDataset = buildPreparedDatasetSnapshot(
    evidenceModality,
    result,
    privacySafePayload,
    decisionSummary,
  );
  if (preparedDataset) {
    preparedDataset.isReadyForDeterministicAnalysis =
      status === "ready_for_analysis" &&
      preparedDataset.unresolvedRequirements.length === 0;
  }

  return {
    organizationId: result.organizationId,
    projectId: result.projectId,
    activityId: result.activityId,
    uploadMetadataId: result.uploadMetadataId,
    privacySafeRepresentationId: result.privacySafeRepresentationId,
    interpretationResultId: result.id,
    status,
    blockingQuestionCount: preparationQuestions.length,
    answeredBlockingQuestionCount: answeredQuestions.length,
    unansweredBlockingQuestionIds: preparationQuestions
      .filter((question) => question.status !== "answered")
      .map((question) => question.id),
    decisions,
    decisionSummary,
    preparedDataset,
  };
}

export class DatasetPreparationService {
  constructor(
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
  ) {}

  async syncForInterpretationResult(
    result: InterpretationResultPersistenceRecord,
  ): Promise<DatasetPreparationPersistenceRecord> {
    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findById(
        result.privacySafeRepresentationId,
        databaseSession,
      );
    const evidenceModality =
      result.evidenceRouting?.evidenceModality ??
      classifyEvidenceModalityFromPayload(
        privacySafeRepresentation?.payload ?? {},
      );
    const privacySafePayload = privacySafeRepresentation?.payload ?? {};

    const preparationQuestions = result.questions.filter((question) =>
      isPreparationQuestion(
        question,
        result.datasetProfile,
        privacySafePayload,
      ),
    );
    const answeredPreparationQuestionCount = preparationQuestions.filter(
      (question) => question.status === "answered" && question.answeredValue,
    ).length;

    const status: DatasetPreparationStatus =
      evidenceModality === "structured_quantitative" ||
      evidenceModality === "mixed_dual_track"
        ? preparationQuestions.length === 0
          ? "ready_for_analysis"
          : answeredPreparationQuestionCount === 0
            ? "not_started"
            : answeredPreparationQuestionCount < preparationQuestions.length
              ? "awaiting_answers"
              : "ready_for_analysis"
        : "not_applicable";

    return this.datasetPreparationRepository.upsertByInterpretationResultId(
      buildPreparationInput(
        result,
        status,
        evidenceModality,
        privacySafePayload,
      ),
      databaseSession,
    );
  }

  async markAnalysisCompleted(
    preparation: DatasetPreparationPersistenceRecord,
  ): Promise<DatasetPreparationPersistenceRecord> {
    if (preparation.status !== "ready_for_analysis") {
      return preparation;
    }

    return this.datasetPreparationRepository.upsertByInterpretationResultId(
      {
        organizationId: preparation.organizationId,
        projectId: preparation.projectId,
        activityId: preparation.activityId,
        uploadMetadataId: preparation.uploadMetadataId,
        privacySafeRepresentationId: preparation.privacySafeRepresentationId,
        interpretationResultId: preparation.interpretationResultId,
        status: "analysis_completed",
        blockingQuestionCount: preparation.blockingQuestionCount,
        answeredBlockingQuestionCount:
          preparation.answeredBlockingQuestionCount,
        unansweredBlockingQuestionIds:
          preparation.unansweredBlockingQuestionIds,
        decisions: preparation.decisions,
        decisionSummary: preparation.decisionSummary,
        preparedDataset: preparation.preparedDataset,
      },
      databaseSession,
    );
  }

  async findByInterpretationResultId(
    interpretationResultId: string,
  ): Promise<DatasetPreparationPersistenceRecord | null> {
    return this.datasetPreparationRepository.findByInterpretationResultId(
      interpretationResultId,
      databaseSession,
    );
  }

  async findByInterpretationResultIds(
    interpretationResultIds: string[],
  ): Promise<DatasetPreparationPersistenceRecord[]> {
    return this.datasetPreparationRepository.findByInterpretationResultIds(
      interpretationResultIds,
      databaseSession,
    );
  }
}
