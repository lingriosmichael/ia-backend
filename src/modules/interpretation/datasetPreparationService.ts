import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfileTable,
  DatasetPreparationDecisionSelection,
  DatasetPreparationStatus,
  EvidenceModality,
  InterpretationQuestionCode,
  PreparedDatasetColumnRole,
  PreparedDatasetIdentifierHandling,
  PreparedDatasetSnapshot,
  PreparedDatasetTable,
} from "../../shared/contracts.js";
import { classifyEvidenceModalityFromPayload } from "../../shared/utils/evidenceModality.js";
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
  "primary_status_field",
  "positive_status_values",
  "primary_date_field",
]);

function isPreparationQuestionCode(
  value: InterpretationQuestionCode | null,
): value is InterpretationQuestionCode {
  return Boolean(value && PREPARATION_QUESTION_CODES.has(value));
}

function isPreparationQuestion(
  question: InterpretationResultPersistenceRecord["questions"][number],
): boolean {
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

    const identifierColumn =
      duplicateResolutionSelection?.columnName ??
      profileTable?.likelyIdentifierColumns[0] ??
      null;
    const identifierHandling =
      parseIdentifierHandling(duplicateResolutionSelection) ??
      (identifierColumn ? "assume_unique" : null);
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
    isPreparationQuestion(question),
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
      isPreparationQuestion(question),
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
