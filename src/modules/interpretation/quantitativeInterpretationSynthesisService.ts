import { databaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { DeterministicAnalysisPersistenceRecord } from "./deterministicAnalysisPersistence.js";
import type { DatasetPreparationPersistenceRecord } from "./datasetPreparationPersistence.js";
import type {
  InterpretationEntityCreateInput,
  InterpretationGoalCoverageCreateInput,
  InterpretationIndicatorCreateInput,
  InterpretationQualitativeFindingCreateInput,
  InterpretationRelationshipCreateInput,
  InterpretationResultPersistenceRecord,
  InterpretationResultSynthesisUpdateInput,
  InterpretationSupportingQuoteCreateInput,
  InterpretationWarningCreateInput,
} from "./interpretationResultPersistence.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";

function readLanguageFromJobPayload(
  payload: Record<string, unknown> | null | undefined,
): "de" | "en" {
  return payload?.language === "en" ? "en" : "de";
}

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumberComponent(
  components: Record<string, unknown>,
  key: string,
): number {
  const value = components[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapEntitiesForReplacement(
  result: InterpretationResultPersistenceRecord,
): InterpretationEntityCreateInput[] {
  return result.entities.map((entity) => ({
    id: entity.id,
    originalField: entity.originalField,
    aiMeaning: entity.aiMeaning,
    entityType: entity.entityType,
    confidence: entity.confidence,
    reason: entity.reason,
    sampleValues: entity.sampleValues,
  }));
}

function mapRelationshipsForReplacement(
  result: InterpretationResultPersistenceRecord,
): InterpretationRelationshipCreateInput[] {
  return result.relationships.map((relationship) => ({
    description: relationship.description,
    involvedEntityIds: relationship.involvedEntityIds,
    confidence: relationship.confidence,
  }));
}

function mapSupportingQuotesForReplacement(
  result: InterpretationResultPersistenceRecord,
): InterpretationSupportingQuoteCreateInput[] {
  return result.supportingQuotes.map((quote) => ({
    id: quote.id,
    excerptText: quote.excerptText,
    excerptKind: quote.excerptKind,
    speakerType: quote.speakerType,
    stage: quote.stage,
    confidence: quote.confidence,
    reason: quote.reason,
    sourceReference: quote.sourceReference,
    privacyMode: quote.privacyMode,
  }));
}

function mapQualitativeFindingsForReplacement(
  result: InterpretationResultPersistenceRecord,
): InterpretationQualitativeFindingCreateInput[] {
  return result.qualitativeFindings.map((finding) => ({
    id: finding.id,
    summary: finding.summary,
    stage: finding.stage,
    confidence: finding.confidence,
    reason: finding.reason,
    relatedEntityIds: finding.relatedEntityIds,
    relatedIndicatorIds: finding.relatedIndicatorIds,
    supportingQuoteIds: finding.supportingQuoteIds,
    category: finding.category,
    outcomeReference: finding.outcomeReference,
    outcomeAnchorType: finding.outcomeAnchorType,
    relationToEvidence: finding.relationToEvidence,
    status: finding.status,
  }));
}

function mapSuggestedCalculation(
  metric: DeterministicAnalysisPersistenceRecord["metrics"][number],
) {
  const sourceColumn = metric.sourceColumns[0] ?? null;
  const positiveStatusValues = Array.isArray(
    metric.components.positiveStatusValues,
  )
    ? metric.components.positiveStatusValues.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (metric.kind === "ratio") {
    return {
      operation: "ratio" as const,
      column: sourceColumn,
      groupByColumn: null,
      numerator: sourceColumn
        ? {
            column: sourceColumn,
            acceptedValues: positiveStatusValues,
          }
        : null,
      denominator: null,
      dateColumn: null,
      valueFilter: null,
    };
  }

  if (metric.kind === "count_distinct") {
    return {
      operation: "count_distinct" as const,
      column: sourceColumn,
      groupByColumn: null,
      numerator: null,
      denominator: null,
      dateColumn: null,
      valueFilter: null,
    };
  }

  return {
    operation: "count" as const,
    column: sourceColumn,
    groupByColumn: null,
    numerator: null,
    denominator: null,
    dateColumn: null,
    valueFilter:
      sourceColumn && positiveStatusValues.length > 0
        ? {
            column: sourceColumn,
            acceptedValues: positiveStatusValues,
          }
        : null,
  };
}

function mapComputedValue(
  metric: DeterministicAnalysisPersistenceRecord["metrics"][number],
) {
  const recordsIncluded =
    readNumberComponent(metric.components, "denominatorCount") ||
    readNumberComponent(metric.components, "rowCount") ||
    readNumberComponent(metric.components, "distinctCount") ||
    readNumberComponent(metric.components, "positiveCount");

  return {
    sourceKind: "computed_from_table" as const,
    value: metric.value,
    unit: metric.unit,
    components: {
      ...metric.components,
      deterministicAnalysisMetricKey: metric.metricKey,
      deterministicFormula: metric.formula,
    },
    recordsIncluded,
    recordsExcluded: 0,
    groundingStatus: "passed" as const,
  };
}

export class QuantitativeInterpretationSynthesisService {
  constructor(
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly pythonProcessingClient: PythonProcessingClient,
  ) {}

  async maybeSyncForInterpretationResult(
    result: InterpretationResultPersistenceRecord,
    datasetPreparation: DatasetPreparationPersistenceRecord | null,
    deterministicAnalysis: DeterministicAnalysisPersistenceRecord | null,
  ): Promise<InterpretationResultPersistenceRecord | null> {
    const preparedDataset = datasetPreparation?.preparedDataset;
    if (
      !datasetPreparation ||
      !deterministicAnalysis ||
      !preparedDataset ||
      (preparedDataset.evidenceModality !== "structured_quantitative" &&
        preparedDataset.evidenceModality !== "mixed_dual_track") ||
      deterministicAnalysis.status !== "ready"
    ) {
      return null;
    }

    const processingJob = await this.processingJobRepository.findById(
      result.processingJobId,
      databaseSession,
    );
    const activity = result.activityId
      ? await this.activityRepository.findById(
          result.activityId,
          databaseSession,
        )
      : null;
    const project = await this.projectRepository.findById(
      result.projectId,
      databaseSession,
    );

    const sharedInput = {
      datasetProfile: toUnknownRecord(result.datasetProfile),
      preparedDataset,
      deterministicAnalysis: {
        status: deterministicAnalysis.status,
        metrics: deterministicAnalysis.metrics,
        distributions: deterministicAnalysis.distributions,
        trends: deterministicAnalysis.trends,
        subgroupBreakdowns: deterministicAnalysis.subgroupBreakdowns,
        categoricalCrosstabs: deterministicAnalysis.categoricalCrosstabs,
        numericCategorySummaries:
          deterministicAnalysis.numericCategorySummaries,
        numericCorrelations: deterministicAnalysis.numericCorrelations,
        warnings: deterministicAnalysis.warnings,
        candidateIndicators: deterministicAnalysis.candidateIndicators,
      },
      language: readLanguageFromJobPayload(processingJob?.payload),
      activityGoals: activity
        ? {
            objectives: activity.objectives,
            successIndicators: activity.successIndicators,
          }
        : null,
      projectGoals: project
        ? {
            projectGoal: project.projectGoal,
            impactModel: project.impactModel,
            successIndicators: project.successIndicators,
          }
        : null,
    };

    const synthesis =
      preparedDataset.evidenceModality === "mixed_dual_track"
        ? await this.pythonProcessingClient.synthesizeMixedInterpretation({
            ...sharedInput,
            qualitativeFindings: result.qualitativeFindings.map((finding) => ({
              id: finding.id,
              summary: finding.summary,
              stage: finding.stage,
              confidence: finding.confidence,
              reason: finding.reason,
              supportingQuoteIds: finding.supportingQuoteIds,
              category: finding.category,
              outcomeReference: finding.outcomeReference,
              outcomeAnchorType: finding.outcomeAnchorType,
              relationToEvidence: finding.relationToEvidence,
            })),
            supportingQuotes: result.supportingQuotes.map((quote) => ({
              id: quote.id,
              excerptText: quote.excerptText,
              excerptKind: quote.excerptKind,
              speakerType: quote.speakerType,
              stage: quote.stage,
              confidence: quote.confidence,
              reason: quote.reason,
              sourceReference: quote.sourceReference,
              privacyMode: quote.privacyMode,
            })),
          })
        : await this.pythonProcessingClient.synthesizeQuantitativeInterpretation(
            sharedInput,
          );

    const metricByKey = new Map(
      deterministicAnalysis.metrics.map((metric) => [metric.metricKey, metric]),
    );

    const indicators: InterpretationIndicatorCreateInput[] = [];
    for (const indicator of synthesis.indicators) {
      const metricKey =
        indicator.computedValue?.components?.deterministicAnalysisMetricKey;
      if (typeof metricKey !== "string") {
        continue;
      }
      const metric = metricByKey.get(metricKey);
      if (!metric) {
        continue;
      }

      indicators.push({
        id: createDocumentId(),
        name: indicator.name,
        description: indicator.description,
        confidence: indicator.confidence,
        reason: indicator.reason,
        relatedEntityIds: [],
        supportingParagraphKeys: [],
        relevanceStage: indicator.relevanceStage,
        matchesStatedGoal: indicator.matchesStatedGoal,
        status: "kept",
        suggestedCalculation: mapSuggestedCalculation(metric),
        computedValue: mapComputedValue(metric),
      });
    }

    const indicatorIdByName = new Map(
      indicators.map((indicator) => [indicator.name, indicator.id]),
    );

    const warnings: InterpretationWarningCreateInput[] = Array.from(
      new Map(
        [...result.warnings, ...synthesis.warnings].map((warning) => [
          `${warning.severity}:${warning.message}`,
          { message: warning.message, severity: warning.severity },
        ]),
      ).values(),
    );

    const goalAlignment: InterpretationGoalCoverageCreateInput[] =
      synthesis.goalAlignment.map((coverage) => ({
        goalSummary: coverage.goalSummary,
        isSupportedByData: coverage.isSupportedByData,
        relatedIndicatorIds: coverage.relatedIndicatorNames
          .map((name) => indicatorIdByName.get(name) ?? null)
          .filter((id): id is string => id !== null),
        gapExplanation: coverage.gapExplanation,
      }));

    const updateInput: InterpretationResultSynthesisUpdateInput = {
      datasetType: synthesis.datasetType,
      overallConfidence: synthesis.overallConfidence,
      entities: mapEntitiesForReplacement(result),
      indicators,
      relationships: mapRelationshipsForReplacement(result),
      qualitativeFindings: mapQualitativeFindingsForReplacement(result),
      supportingQuotes: mapSupportingQuotesForReplacement(result),
      warnings,
      goalAlignment,
    };

    return this.interpretationResultRepository.replaceSynthesisArtifacts(
      result.id,
      updateInput,
      databaseSession,
    );
  }
}
