import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfileTable,
  DatasetPreparationDecisionSelection,
  DatasetPreparationStatus,
  EpistemicRole,
  EvidenceModality,
  InterpretationQuestionCode,
  PreparedDatasetColumnRole,
  PreparedDatasetIdentifierHandling,
  PreparedDatasetSnapshot,
  PreparedDatasetTable,
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

const PREPARATION_QUESTION_CODES = new Set<InterpretationQuestionCode>([
  "normalization_merge",
  "row_grain",
  "duplicate_identifier_resolution",
  "epistemic_role_clarification",
  "validated_scale_confirmation",
  "cohort_tag",
  "pairing_group_key",
  "pairing_group_role",
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

function emptyDecisionSummary() {
  return {
    normalizationMerges: [] as DatasetPreparationDecisionSelection[],
    rowGrains: [] as DatasetPreparationDecisionSelection[],
    duplicateIdentifierResolutions: [] as DatasetPreparationDecisionSelection[],
    primaryStatusFields: [] as DatasetPreparationDecisionSelection[],
    positiveStatusDefinitions: [] as DatasetPreparationDecisionSelection[],
    primaryDateFields: [] as DatasetPreparationDecisionSelection[],
    epistemicRoleClarifications: [] as DatasetPreparationDecisionSelection[],
    validatedScaleConfirmations: [] as DatasetPreparationDecisionSelection[],
    cohortTags: [] as DatasetPreparationDecisionSelection[],
    pairingGroupKeys: [] as DatasetPreparationDecisionSelection[],
    pairingGroupRoles: [] as DatasetPreparationDecisionSelection[],
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
    case "validated_scale_confirmation":
      return "validatedScaleConfirmations";
    case "cohort_tag":
      return "cohortTags";
    case "pairing_group_key":
      return "pairingGroupKeys";
    case "pairing_group_role":
      return "pairingGroupRoles";
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
    answer.includes("mehrere ereignisse")
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
    normalized.includes("reviewer") ||
    normalized.includes("prüfende")
  ) {
    return "subjective_code";
  }
  if (
    normalized.includes("free text") ||
    normalized.includes("freie texte") ||
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
    normalized.includes("something else") ||
    normalized.includes("etwas anderes") ||
    normalized.includes("plain descriptive") ||
    normalized.includes("normales datenfeld")
  ) {
    return "categorical";
  }
  return null;
}

// Matches _VALIDATED_SCALE_CONFIRMATION_OPTIONS — same closed-option-set
// reasoning as parseEpistemicRoleClarificationAnswer above.
function parseValidatedScaleConfirmationAnswer(
  answer: string | null,
): boolean | null {
  if (!answer) {
    return null;
  }
  const normalized = normalizeText(answer);
  if (normalized.startsWith("yes") || normalized.startsWith("ja")) {
    return true;
  }
  if (normalized.startsWith("no") || normalized.startsWith("nein")) {
    return false;
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

// pairing_group_key is free text (an instrument label, e.g. "Wellbeing
// scale") — trusted verbatim except for the same "not applicable" escape
// hatch as cohort_tag, so a column not part of any repeated measurement
// doesn't need an invented label.
const PAIRING_GROUP_KEY_NOT_APPLICABLE_MARKERS = [
  "not applicable",
  "n/a",
  "nicht zutreffend",
  "keine",
];

function parsePairingGroupKeyAnswer(answer: string | null): string | null {
  if (!answer) {
    return null;
  }
  const trimmed = answer.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeText(trimmed);
  if (
    PAIRING_GROUP_KEY_NOT_APPLICABLE_MARKERS.some((marker) =>
      normalized.includes(marker),
    )
  ) {
    return null;
  }
  return trimmed;
}

// Matches _PAIRING_GROUP_ROLE_OPTIONS — same closed-option-set reasoning as
// parseValidatedScaleConfirmationAnswer above.
function parsePairingGroupRoleAnswer(
  answer: string | null,
): "before" | "after" | null {
  if (!answer) {
    return null;
  }
  const normalized = normalizeText(answer);
  if (
    normalized.startsWith("before") ||
    normalized.startsWith("baseline") ||
    normalized.startsWith("vorher")
  ) {
    return "before";
  }
  if (
    normalized.startsWith("after") ||
    normalized.startsWith("endline") ||
    normalized.startsWith("nachher")
  ) {
    return "after";
  }
  return null;
}

function parsePositiveStatusValues(
  answer: string | null,
  observedValues: string[],
): string[] {
  if (!answer) {
    return [];
  }
  const normalizedAnswer = normalizeText(answer);
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
      // choice between subjective_code/free_text, and a validated_scale
      // candidate needs an explicit human confirmation before it's
      // upgraded from the safe metric_count default — never auto-resolved
      // (Section 3 of QUALITATIVE_MIXED_EVIDENCE_PLAN.md).
      const epistemicRoleClarificationAnswer =
        decisionSummary.epistemicRoleClarifications.find(
          (selection) =>
            selection.tableName === tableName &&
            selection.columnName === columnName,
        ) ?? null;
      const validatedScaleConfirmationAnswer =
        decisionSummary.validatedScaleConfirmations.find(
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
          : profileColumn?.isValidatedScaleCandidate &&
              parseValidatedScaleConfirmationAnswer(
                validatedScaleConfirmationAnswer?.value ?? null,
              ) === true
            ? "validated_scale"
            : baseEpistemicRole;

      // Only meaningful once a column is actually confirmed validated_scale
      // — mirrors how positiveStatusValues is only kept for the resolved
      // primaryStatusColumn, rather than trusting an answer to a question
      // whose premise (this column being a validated scale) didn't end up
      // holding.
      const pairingGroupKeyAnswer = decisionSummary.pairingGroupKeys.find(
        (selection) =>
          selection.tableName === tableName &&
          selection.columnName === columnName,
      );
      const pairingGroupRoleAnswer = decisionSummary.pairingGroupRoles.find(
        (selection) =>
          selection.tableName === tableName &&
          selection.columnName === columnName,
      );

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
        minValue: profileColumn?.numericSummary?.min ?? null,
        maxValue: profileColumn?.numericSummary?.max ?? null,
        pairingGroupKey:
          epistemicRole === "validated_scale"
            ? parsePairingGroupKeyAnswer(pairingGroupKeyAnswer?.value ?? null)
            : null,
        pairingGroupRole:
          epistemicRole === "validated_scale"
            ? parsePairingGroupRoleAnswer(pairingGroupRoleAnswer?.value ?? null)
            : null,
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
    };
    decisionSummary[mapQuestionCodeToSummaryKey(question.questionCode!)].push(
      selection,
    );

    return {
      questionId: question.id,
      questionCode: question.questionCode!,
      questionPrompt: question.prompt,
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
