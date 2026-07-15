import { databaseSession } from "../../shared/database/databaseClient.js";
import type { FastifyBaseLogger } from "fastify";
import type {
  DatasetProfile,
  DatasetProfileColumn,
  DatasetProfileColumnType,
  DatasetProfileDateSummary,
  DatasetProfileIssue,
  DatasetProfileIssueCode,
  DatasetProfileNumericSummary,
  DatasetProfileTable,
  DatasetProfileValueCount,
  EvidenceRoutingDecision,
  IndicatorCalculationOperation,
  IndicatorComputedValueGroundingStatus,
  IndicatorComputedValueSourceKind,
  IndicatorRelevanceStage,
  InterpretationIndicatorComputedValue,
  InterpretationIndicatorSuggestedCalculation,
  InterpretationIndicatorValueFilter,
  InterpretationQuestionCode,
  InterpretationQuestionKind,
  InterpretationWarningSeverity,
  ProcessingJobStatus,
} from "../../shared/contracts.js";
import {
  datasetProfileColumnTypeValues,
  datasetProfileIssueCodeValues,
  indicatorCalculationOperationValues,
  indicatorComputedValueGroundingStatusValues,
  indicatorComputedValueSourceKindValues,
  indicatorRelevanceStageValues,
} from "../../shared/contracts.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type {
  InterpretationEntityCreateInput,
  InterpretationQualitativeFindingCreateInput,
  InterpretationGoalCoverageCreateInput,
  InterpretationIndicatorCreateInput,
  InterpretationQuestionCreateInput,
  InterpretationRelationshipCreateInput,
  InterpretationSupportingQuoteCreateInput,
  InterpretationWarningCreateInput,
} from "./interpretationResultPersistence.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import { clearActivityInterpretationAcknowledgmentIfPresent } from "./interpretationReviewState.js";
import { DatasetPreparationService } from "./datasetPreparationService.js";
import { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";

type ProcessingStatusDetails = Record<string, unknown> | null | undefined;

const interpretationQuestionKinds: readonly InterpretationQuestionKind[] = [
  "single_choice",
  "free_text",
  "merge_confirmation",
];
const interpretationQuestionDomains = [
  "preparation",
  "interpretation",
] as const;
const interpretationQuestionCodes: readonly InterpretationQuestionCode[] = [
  "normalization_merge",
  "row_grain",
  "duplicate_identifier_resolution",
  "primary_status_field",
  "positive_status_values",
  "primary_date_field",
];

const interpretationWarningSeverities: readonly InterpretationWarningSeverity[] =
  ["info", "warning"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readQuestionKind(value: unknown): InterpretationQuestionKind {
  return interpretationQuestionKinds.includes(
    value as InterpretationQuestionKind,
  )
    ? (value as InterpretationQuestionKind)
    : "free_text";
}

function readQuestionDomain(value: unknown): "preparation" | "interpretation" {
  return interpretationQuestionDomains.includes(
    value as (typeof interpretationQuestionDomains)[number],
  )
    ? (value as (typeof interpretationQuestionDomains)[number])
    : "interpretation";
}

function readQuestionCode(value: unknown): InterpretationQuestionCode | null {
  return interpretationQuestionCodes.includes(
    value as InterpretationQuestionCode,
  )
    ? (value as InterpretationQuestionCode)
    : null;
}

function readWarningSeverity(value: unknown): InterpretationWarningSeverity {
  return interpretationWarningSeverities.includes(
    value as InterpretationWarningSeverity,
  )
    ? (value as InterpretationWarningSeverity)
    : "info";
}

function readDatasetProfileColumnType(
  value: unknown,
): DatasetProfileColumnType {
  return datasetProfileColumnTypeValues.includes(
    value as DatasetProfileColumnType,
  )
    ? (value as DatasetProfileColumnType)
    : "unknown";
}

function readDatasetProfileIssueCode(value: unknown): DatasetProfileIssueCode {
  return datasetProfileIssueCodeValues.includes(
    value as DatasetProfileIssueCode,
  )
    ? (value as DatasetProfileIssueCode)
    : "row_grain_ambiguous";
}

function readDatasetProfileValueCounts(
  value: unknown,
): DatasetProfileValueCount[] {
  return readRecordArray(value).map((entry) => ({
    value: readString(entry.value),
    count: readNumber(entry.count),
  }));
}

function readDatasetProfileNumericSummary(
  value: unknown,
): DatasetProfileNumericSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    min: readNumber(value.min),
    max: readNumber(value.max),
    mean: readNumber(value.mean),
  };
}

function readDatasetProfileDateSummary(
  value: unknown,
): DatasetProfileDateSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const min = readNullableString(value.min);
  const max = readNullableString(value.max);
  if (!min || !max) {
    return null;
  }
  return { min, max };
}

function readDatasetProfileColumns(value: unknown): DatasetProfileColumn[] {
  return readRecordArray(value).map((entry) => ({
    name: readString(entry.name, "unknown_column"),
    inferredType: readDatasetProfileColumnType(entry.inferredType),
    roleHints: readStringArray(entry.roleHints),
    nullPercentage: readNumber(entry.nullPercentage),
    distinctCount: readNumber(entry.distinctCount),
    averageTextLength:
      typeof entry.averageTextLength === "number" &&
      Number.isFinite(entry.averageTextLength)
        ? entry.averageTextLength
        : null,
    topValues: readDatasetProfileValueCounts(entry.topValues),
    numericSummary: readDatasetProfileNumericSummary(entry.numericSummary),
    dateSummary: readDatasetProfileDateSummary(entry.dateSummary),
    duplicateNonNullValueCount: readNumber(entry.duplicateNonNullValueCount),
  }));
}

function readDatasetProfileIssues(value: unknown): DatasetProfileIssue[] {
  return readRecordArray(value).map((entry) => ({
    code: readDatasetProfileIssueCode(entry.code),
    severity: readWarningSeverity(entry.severity),
    tableName: readString(entry.tableName, "table"),
    columnName: readNullableString(entry.columnName),
    message: readString(entry.message),
  }));
}

function readDatasetProfileTables(value: unknown): DatasetProfileTable[] {
  return readRecordArray(value).map((entry) => ({
    name: readString(entry.name, "table"),
    rowCount: readNumber(entry.rowCount),
    columnCount: readNumber(entry.columnCount),
    likelyIdentifierColumns: readStringArray(entry.likelyIdentifierColumns),
    likelyStatusColumns: readStringArray(entry.likelyStatusColumns),
    likelyStageColumns: readStringArray(entry.likelyStageColumns),
    likelyDateColumns: readStringArray(entry.likelyDateColumns),
    likelyMeasureColumns: readStringArray(entry.likelyMeasureColumns),
    likelyFreeTextColumns: readStringArray(entry.likelyFreeTextColumns),
    likelySubgroupColumns: readStringArray(entry.likelySubgroupColumns),
    columns: readDatasetProfileColumns(entry.columns),
  }));
}

function readDatasetProfile(value: unknown): DatasetProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    tableCount: readNumber(value.tableCount),
    paragraphCount: readNumber(value.paragraphCount),
    tables: readDatasetProfileTables(value.tables),
    issues: readDatasetProfileIssues(value.issues),
  };
}

function readEvidenceRouting(value: unknown): EvidenceRoutingDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const evidenceModality = readString(value.evidenceModality);
  const decisionSource = readString(value.decisionSource);
  if (
    (evidenceModality !== "structured_quantitative" &&
      evidenceModality !== "structured_qualitative" &&
      evidenceModality !== "mixed_dual_track" &&
      evidenceModality !== "narrative_qualitative" &&
      evidenceModality !== "insufficiently_extracted") ||
    (decisionSource !== "deterministic" && decisionSource !== "llm_tiebreaker")
  ) {
    return null;
  }

  return {
    evidenceModality,
    decisionSource,
    routingConfidence: readNumber(value.routingConfidence),
    quantitativeUtilityScore: readNumber(value.quantitativeUtilityScore),
    qualitativeUtilityScore: readNumber(value.qualitativeUtilityScore),
    reasons: readStringArray(value.reasons),
  };
}

function readIndicatorRelevanceStage(
  value: unknown,
): IndicatorRelevanceStage | null {
  return indicatorRelevanceStageValues.includes(
    value as IndicatorRelevanceStage,
  )
    ? (value as IndicatorRelevanceStage)
    : null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readIndicatorCalculationOperation(
  value: unknown,
): IndicatorCalculationOperation | null {
  return indicatorCalculationOperationValues.includes(
    value as IndicatorCalculationOperation,
  )
    ? (value as IndicatorCalculationOperation)
    : null;
}

function readIndicatorValueFilter(
  value: unknown,
): InterpretationIndicatorValueFilter | null {
  if (!isRecord(value)) {
    return null;
  }
  const column = readNullableString(value.column);
  if (!column) {
    return null;
  }
  return { column, acceptedValues: readStringArray(value.acceptedValues) };
}

// suggestedCalculation's column/groupByColumn/dateColumn/numerator.column/
// denominator.column/valueFilter.column are real data-column names
// (originalField values), not entity ids — unlike relatedFields above,
// they never get resolved through entityIdByOriginalField, since the
// deterministic executor in ia_python_service already validated them
// against real columns before this ever reaches ia_backend (see "Phase 4
// — Project Knowledge Model.md", "Indicator Value Computation").
function readSuggestedCalculation(
  value: unknown,
): InterpretationIndicatorSuggestedCalculation | null {
  if (!isRecord(value)) {
    return null;
  }
  const operation = readIndicatorCalculationOperation(value.operation);
  if (!operation) {
    return null;
  }
  return {
    operation,
    column: readNullableString(value.column),
    groupByColumn: readNullableString(value.groupByColumn),
    numerator: readIndicatorValueFilter(value.numerator),
    denominator: readIndicatorValueFilter(value.denominator),
    dateColumn: readNullableString(value.dateColumn),
    valueFilter: readIndicatorValueFilter(value.valueFilter),
  };
}

function readIndicatorComputedValueSourceKind(
  value: unknown,
): IndicatorComputedValueSourceKind | null {
  return indicatorComputedValueSourceKindValues.includes(
    value as IndicatorComputedValueSourceKind,
  )
    ? (value as IndicatorComputedValueSourceKind)
    : null;
}

function readIndicatorComputedValueGroundingStatus(
  value: unknown,
): IndicatorComputedValueGroundingStatus {
  return indicatorComputedValueGroundingStatusValues.includes(
    value as IndicatorComputedValueGroundingStatus,
  )
    ? (value as IndicatorComputedValueGroundingStatus)
    : "failed_column_not_found";
}

function readComputedValue(
  value: unknown,
): InterpretationIndicatorComputedValue | null {
  if (!isRecord(value)) {
    return null;
  }
  const sourceKind = readIndicatorComputedValueSourceKind(value.sourceKind);
  if (!sourceKind) {
    return null;
  }
  return {
    sourceKind,
    value: readNullableNumber(value.value),
    unit: readNullableString(value.unit),
    components: isRecord(value.components) ? value.components : {},
    recordsIncluded: readNumber(value.recordsIncluded),
    recordsExcluded: readNumber(value.recordsExcluded),
    groundingStatus: readIndicatorComputedValueGroundingStatus(
      value.groundingStatus,
    ),
  };
}

function mapEntities(value: unknown): InterpretationEntityCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    id: createDocumentId(),
    originalField: readString(entry.originalField, "unknown_field"),
    aiMeaning: readString(entry.aiMeaning, "Unclassified"),
    entityType: readString(entry.entityType, "unknown"),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    sampleValues: readStringArray(entry.sampleValues),
  }));
}

// Python has no concept of the entity ids this service is about to generate,
// so it correlates indicators/relationships to entities by the entity's
// originalField name instead (wire fields relatedFields/involvedFields).
// This resolves those names to the real, freshly-generated entity ids so
// the persisted relatedEntityIds/involvedEntityIds are genuine references,
// not dangling strings that never match anything.
function resolveEntityIds(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): string[] {
  return readStringArray(value)
    .map((originalField) => entityIdByOriginalField.get(originalField))
    .filter((id): id is string => Boolean(id));
}

function mapIndicators(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): InterpretationIndicatorCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    id: createDocumentId(),
    name: readString(entry.name, "Unnamed indicator"),
    description: readString(entry.description),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    relatedEntityIds: resolveEntityIds(
      entry.relatedFields,
      entityIdByOriginalField,
    ),
    supportingParagraphKeys: readStringArray(entry.supportingParagraphKeys),
    relevanceStage: readIndicatorRelevanceStage(entry.relevanceStage),
    matchesStatedGoal: entry.matchesStatedGoal === true,
    status: "kept",
    suggestedCalculation: readSuggestedCalculation(entry.suggestedCalculation),
    computedValue: readComputedValue(entry.computedValue),
  }));
}

// Python has no concept of the indicator ids this service is about to
// generate, so goalAlignment correlates coverage entries to indicators by
// the indicator's name instead. This resolves those names to the real,
// freshly-generated indicator ids, same rationale as resolveEntityIds above.
function resolveIndicatorIds(
  value: unknown,
  indicatorIdByName: ReadonlyMap<string, string>,
): string[] {
  return readStringArray(value)
    .map((name) => indicatorIdByName.get(name))
    .filter((id): id is string => Boolean(id));
}

function mapGoalAlignment(
  value: unknown,
  indicatorIdByName: ReadonlyMap<string, string>,
): InterpretationGoalCoverageCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    goalSummary: readString(entry.goalSummary, "Unspecified goal"),
    isSupportedByData: entry.isSupportedByData === true,
    relatedIndicatorIds: resolveIndicatorIds(
      entry.relatedIndicatorNames,
      indicatorIdByName,
    ),
    gapExplanation: readNullableString(entry.gapExplanation),
  }));
}

function mapRelationships(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
): InterpretationRelationshipCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    description: readString(entry.description),
    involvedEntityIds: resolveEntityIds(
      entry.involvedFields,
      entityIdByOriginalField,
    ),
    confidence: readNumber(entry.confidence),
  }));
}

type MappedSupportingQuote = InterpretationSupportingQuoteCreateInput & {
  quoteKey: string;
};

function mapSupportingQuotes(value: unknown): MappedSupportingQuote[] {
  return readRecordArray(value).map((entry, index) => ({
    id: createDocumentId(),
    quoteKey: readString(entry.quoteKey, `quote_${index + 1}`),
    excerptText: readString(entry.excerptText),
    excerptKind:
      readString(entry.excerptKind) === "direct" ? "direct" : "paraphrased",
    speakerType: (() => {
      const speakerType = readString(entry.speakerType);
      return speakerType === "participant" ||
        speakerType === "caregiver" ||
        speakerType === "staff" ||
        speakerType === "volunteer" ||
        speakerType === "evaluator"
        ? speakerType
        : "unknown";
    })(),
    stage: (() => {
      const stage = readString(entry.stage);
      return stage === "output" ||
        stage === "outcome" ||
        stage === "impact" ||
        stage === "risk"
        ? stage
        : "context";
    })(),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    sourceReference: readString(entry.sourceReference, `Quote ${index + 1}`),
    privacyMode:
      readString(entry.privacyMode) === "verbatim_safe"
        ? "verbatim_safe"
        : readString(entry.privacyMode) === "redacted"
          ? "redacted"
          : "paraphrased_only",
  }));
}

function mapQualitativeFindings(
  value: unknown,
  entityIdByOriginalField: ReadonlyMap<string, string>,
  indicatorIdByName: ReadonlyMap<string, string>,
  supportingQuoteIdByKey: ReadonlyMap<string, string>,
): InterpretationQualitativeFindingCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    id: createDocumentId(),
    summary: readString(entry.summary, "Qualitative finding"),
    stage: (() => {
      const stage = readString(entry.stage);
      return stage === "output" ||
        stage === "outcome" ||
        stage === "impact" ||
        stage === "risk"
        ? stage
        : "context";
    })(),
    confidence: readNumber(entry.confidence),
    reason: readString(entry.reason),
    relatedEntityIds: resolveEntityIds(
      entry.relatedFieldNames,
      entityIdByOriginalField,
    ),
    relatedIndicatorIds: resolveIndicatorIds(
      entry.relatedIndicatorNames,
      indicatorIdByName,
    ),
    supportingQuoteIds: readStringArray(entry.supportingQuoteKeys)
      .map((quoteKey) => supportingQuoteIdByKey.get(quoteKey))
      .filter((id): id is string => Boolean(id)),
    category: (() => {
      const category = readString(entry.category);
      return category === "outcome_support" ||
        category === "outcome_complication" ||
        category === "outcome_contradiction" ||
        category === "barrier" ||
        category === "enabler" ||
        category === "unintended_effect"
        ? category
        : "context_only";
    })(),
    outcomeReference: readNullableString(entry.outcomeReference),
    outcomeAnchorType: (() => {
      const anchorType = readString(entry.outcomeAnchorType);
      return anchorType === "project_outcome" ||
        anchorType === "project_impact" ||
        anchorType === "activity_objective" ||
        anchorType === "activity_success_indicator"
        ? anchorType
        : "unanchored";
    })(),
    relationToEvidence: (() => {
      const relation = readString(entry.relationToEvidence);
      return relation === "reinforces" ||
        relation === "contradicts" ||
        relation === "complicates"
        ? relation
        : "context_only";
    })(),
    status: "kept",
  }));
}

function mapQuestions(value: unknown): InterpretationQuestionCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    prompt: readString(entry.prompt, "Can you confirm this interpretation?"),
    kind: readQuestionKind(entry.kind),
    questionDomain: readQuestionDomain(entry.questionDomain),
    options: Array.isArray(entry.options)
      ? readStringArray(entry.options)
      : null,
    isBlocking: readBoolean(
      entry.isBlocking,
      readQuestionKind(entry.kind) !== "free_text",
    ),
    questionCode: readQuestionCode(entry.questionCode),
    targetTableName: readNullableString(entry.targetTableName),
    targetColumnName: readNullableString(entry.targetColumnName),
  }));
}

function mapWarnings(value: unknown): InterpretationWarningCreateInput[] {
  return readRecordArray(value).map((entry) => ({
    message: readString(entry.message),
    severity: readWarningSeverity(entry.severity),
  }));
}

export class InterpretationArtifactService {
  constructor(
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly datasetPreparationService: DatasetPreparationService,
    private readonly deterministicAnalysisService: DeterministicAnalysisService,
    private readonly quantitativeInterpretationSynthesisService: QuantitativeInterpretationSynthesisService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async ingestProcessorArtifacts(
    job: ProcessingJobPersistenceRecord,
    details: ProcessingStatusDetails,
    targetStatus: ProcessingJobStatus,
  ): Promise<void> {
    if (targetStatus !== "completed" || !isRecord(details)) {
      return;
    }

    const interpretation = details.interpretation;
    if (!isRecord(interpretation) || !job.uploadMetadataId) {
      return;
    }

    const privacySafeRepresentationId = readNullableString(
      isRecord(job.payload) ? job.payload.privacySafeRepresentationId : null,
    );
    if (!privacySafeRepresentationId) {
      return;
    }

    const previous =
      await this.interpretationResultRepository.findLatestByPrivacySafeRepresentationId(
        privacySafeRepresentationId,
        databaseSession,
      );

    const entities = mapEntities(interpretation.entities);
    const entityIdByOriginalField = new Map(
      entities.map((entity) => [entity.originalField, entity.id]),
    );

    const indicators = mapIndicators(
      interpretation.indicators,
      entityIdByOriginalField,
    );
    const indicatorIdByName = new Map(
      indicators.map((indicator) => [indicator.name, indicator.id]),
    );
    const supportingQuotes = mapSupportingQuotes(
      interpretation.supportingQuotes,
    );
    const supportingQuoteIdByKey = new Map<string, string>();
    for (const quote of supportingQuotes) {
      if (supportingQuoteIdByKey.has(quote.quoteKey)) {
        this.logger.warn(
          {
            processingJobId: job.id,
            uploadMetadataId: job.uploadMetadataId,
            quoteKey: quote.quoteKey,
          },
          "Duplicate supporting quote key in interpretation artifact; keeping first occurrence",
        );
        continue;
      }
      supportingQuoteIdByKey.set(quote.quoteKey, quote.id);
    }

    const created = await this.interpretationResultRepository.create(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        privacySafeRepresentationId,
        processingJobId: job.id,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        previousInterpretationResultId: previous?.id ?? null,
        datasetType: readString(interpretation.datasetType, "unknown"),
        overallConfidence: readNumber(interpretation.overallConfidence),
        evidenceRouting: readEvidenceRouting(interpretation.evidenceRouting),
        datasetProfile: readDatasetProfile(interpretation.datasetProfile),
        entities,
        indicators,
        relationships: mapRelationships(
          interpretation.relationships,
          entityIdByOriginalField,
        ),
        qualitativeFindings: mapQualitativeFindings(
          interpretation.qualitativeFindings,
          entityIdByOriginalField,
          indicatorIdByName,
          supportingQuoteIdByKey,
        ),
        supportingQuotes: supportingQuotes.map(
          ({ quoteKey: _quoteKey, ...quote }) => quote,
        ),
        questions: mapQuestions(interpretation.questions),
        warnings: mapWarnings(interpretation.warnings),
        goalAlignment: mapGoalAlignment(
          interpretation.goalAlignment,
          indicatorIdByName,
        ),
      },
      databaseSession,
    );

    const datasetPreparation =
      await this.datasetPreparationService.syncForInterpretationResult(created);
    const deterministicAnalysis =
      await this.deterministicAnalysisService.syncForInterpretationResult(
        created,
        datasetPreparation,
      );
    const updatedPreparation =
      deterministicAnalysis.status === "ready"
        ? await this.datasetPreparationService.markAnalysisCompleted(
            datasetPreparation,
          )
        : datasetPreparation;
    try {
      await this.quantitativeInterpretationSynthesisService.maybeSyncForInterpretationResult(
        created,
        updatedPreparation,
        deterministicAnalysis,
      );
    } catch (error) {
      this.logger.error(
        {
          interpretationResultId: created.id,
          uploadMetadataId: created.uploadMetadataId,
          error,
        },
        "quantitative interpretation synthesis could not be completed during artifact ingest",
      );
    }

    // A new interpretation result means the activity's knowledge just
    // changed — whether from a first-time upload or a re-run on existing
    // evidence — so any prior "nothing left to decide" acknowledgment no
    // longer applies and must be cleared, not left silently stale.
    if (job.activityId) {
      await clearActivityInterpretationAcknowledgmentIfPresent(
        this.activityRepository,
        job.activityId,
        databaseSession,
      );
    }
  }
}
