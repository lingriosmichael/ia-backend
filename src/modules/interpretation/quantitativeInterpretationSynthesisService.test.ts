import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";
import type { DeterministicAnalysisPersistenceRecord } from "./deterministicAnalysisPersistence.js";
import type { DatasetPreparationPersistenceRecord } from "./datasetPreparationPersistence.js";
import type {
  InterpretationResultPersistenceRecord,
  InterpretationResultSynthesisUpdateInput,
} from "./interpretationResultPersistence.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeResult(
  overrides: Partial<InterpretationResultPersistenceRecord> = {},
): InterpretationResultPersistenceRecord {
  return {
    id: "result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "psr-1",
    processingJobId: "job-1",
    versionNumber: 1,
    previousInterpretationResultId: null,
    datasetType: "attendance",
    overallConfidence: 0.35,
    evidenceRouting: null,
    datasetProfile: null,
    entities: [],
    indicators: [],
    relationships: [],
    qualitativeFindings: [],
    supportingQuotes: [],
    questions: [],
    warnings: [
      { id: "warning-1", message: "Existing warning", severity: "info" },
    ],
    goalAlignment: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makePreparation(
  overrides: Partial<DatasetPreparationPersistenceRecord> = {},
): DatasetPreparationPersistenceRecord {
  return {
    id: "prep-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "psr-1",
    interpretationResultId: "result-1",
    status: "analysis_completed",
    blockingQuestionCount: 0,
    answeredBlockingQuestionCount: 0,
    unansweredBlockingQuestionIds: [],
    decisions: [],
    decisionSummary: {
      normalizationMerges: [],
      rowGrains: [],
      duplicateIdentifierResolutions: [],
      primaryStatusFields: [],
      positiveStatusDefinitions: [],
      primaryDateFields: [],
    },
    preparedDataset: {
      evidenceModality: "structured_quantitative",
      isReadyForDeterministicAnalysis: true,
      unresolvedRequirements: [],
      tables: [
        {
          name: "attendance",
          rowCount: 10,
          columnCount: 2,
          selectedRowGrain: "One row is one participant.",
          identifierColumn: "participant_id",
          identifierHandling: "assume_unique",
          primaryStatusColumn: "status",
          primaryDateColumn: null,
          columns: [
            {
              name: "participant_id",
              inferredType: "identifier",
              role: "identifier",
              positiveStatusValues: [],
              positiveStatusDefinitionText: null,
              normalizationAccepted: null,
            },
            {
              name: "status",
              inferredType: "categorical",
              role: "primary_status",
              positiveStatusValues: ["completed"],
              positiveStatusDefinitionText: "completed is positive",
              normalizationAccepted: true,
            },
          ],
          notes: [],
        },
      ],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeAnalysis(
  overrides: Partial<DeterministicAnalysisPersistenceRecord> = {},
): DeterministicAnalysisPersistenceRecord {
  return {
    id: "analysis-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "psr-1",
    interpretationResultId: "result-1",
    datasetPreparationId: "prep-1",
    status: "ready",
    metrics: [
      {
        metricKey: "attendance::positive_status_ratio",
        label: "status positive ratio",
        description: "Share of positive rows",
        tableName: "attendance",
        sourceColumns: ["status"],
        kind: "ratio",
        formula: "COUNT(status in {completed}) / COUNT(rows)",
        value: 0.8,
        unit: "ratio",
        components: {
          numeratorCount: 8,
          denominatorCount: 10,
          positiveStatusValues: ["completed"],
        },
      },
    ],
    distributions: [],
    trends: [],
    subgroupBreakdowns: [],
    warnings: [],
    candidateIndicators: [
      {
        indicatorKey: "attendance::positive_status_ratio",
        label: "Completion rate",
        description: "Share of completed participants",
        tableName: "attendance",
        formula: "COUNT(status in {completed}) / COUNT(rows)",
        value: 0.8,
        unit: "ratio",
        sourceColumns: ["status"],
        groundingNote: "Deterministic metric",
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("maps quantitative synthesis output back into the interpretation result", async () => {
  let capturedUpdate: InterpretationResultSynthesisUpdateInput | null = null;

  const interpretationResultRepository = {
    replaceSynthesisArtifacts: async (
      _interpretationResultId: string,
      input: InterpretationResultSynthesisUpdateInput,
    ) => {
      capturedUpdate = input;
      return makeResult({
        datasetType: input.datasetType,
        overallConfidence: input.overallConfidence,
        indicators: input.indicators.map((indicator) => ({
          id: indicator.id,
          name: indicator.name,
          description: indicator.description,
          confidence: indicator.confidence,
          reason: indicator.reason,
          relatedEntityIds: [],
          supportingParagraphKeys: [],
          relevanceStage: indicator.relevanceStage,
          matchesStatedGoal: indicator.matchesStatedGoal,
          status: "kept",
          suggestedCalculation: indicator.suggestedCalculation,
          computedValue: indicator.computedValue,
        })),
        warnings: input.warnings.map((warning, index) => ({
          id: `warning-${index + 1}`,
          message: warning.message,
          severity: warning.severity,
        })),
        goalAlignment: input.goalAlignment.map((coverage, index) => ({
          id: `coverage-${index + 1}`,
          goalSummary: coverage.goalSummary,
          isSupportedByData: coverage.isSupportedByData,
          relatedIndicatorIds: coverage.relatedIndicatorIds,
          gapExplanation: coverage.gapExplanation,
        })),
      });
    },
  } as unknown as InterpretationResultRepository;

  const processingJobRepository = {
    findById: async () => ({
      id: "job-1",
      payload: { language: "en" },
    }),
  } as unknown as ProcessingJobRepository;

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity",
      description: null,
      activityType: null,
      owner: null,
      startDate: null,
      endDate: null,
      objectives: "Increase program completion.",
      successIndicators: "Completion rate increases.",
      targetAudience: null,
      additionalContext: null,
      status: "active",
      interpretationAcknowledgedAt: null,
      interpretationAcknowledgedById: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ActivityRepository;

  const projectRepository = {
    findById: async () => ({
      id: "project-1",
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Project",
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: "Participants complete mentoring.",
        outcomes: "Participants improve outcomes.",
        impact: null,
      },
      successIndicators: "Completion rate",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ProjectRepository;

  const pythonProcessingClient = {
    synthesizeQuantitativeInterpretation: async () => ({
      datasetType: "Participant completion dataset",
      overallConfidence: 0.88,
      indicators: [
        {
          name: "Participant completion rate",
          description: "Share of participants marked as completed.",
          confidence: 0.92,
          reason: "Directly measures the stated completion outcome.",
          relatedFields: ["status"],
          supportingParagraphKeys: [],
          relevanceStage: "outcome",
          matchesStatedGoal: true,
          suggestedCalculation: null,
          computedValue: {
            sourceKind: "computed_from_table",
            value: 0.8,
            unit: "ratio",
            components: {
              deterministicAnalysisMetricKey:
                "attendance::positive_status_ratio",
            },
            recordsIncluded: 10,
            recordsExcluded: 0,
            groundingStatus: "passed",
          },
        },
      ],
      warnings: [
        {
          message: "Review subgroup coverage before comparing cohorts.",
          severity: "warning",
        },
      ],
      goalAlignment: [
        {
          goalSummary: "Increase program completion.",
          isSupportedByData: true,
          relatedIndicatorNames: ["Participant completion rate"],
          gapExplanation: null,
        },
      ],
    }),
  } as unknown as PythonProcessingClient;

  const service = new QuantitativeInterpretationSynthesisService(
    interpretationResultRepository,
    processingJobRepository,
    activityRepository,
    projectRepository,
    pythonProcessingClient,
  );

  const updated = await service.maybeSyncForInterpretationResult(
    makeResult(),
    makePreparation(),
    makeAnalysis(),
  );

  assert.ok(updated);
  assert.ok(capturedUpdate);
  if (capturedUpdate === null) {
    throw new Error("Expected synthesis update input.");
  }
  const update: InterpretationResultSynthesisUpdateInput = capturedUpdate;
  assert.equal(update.datasetType, "Participant completion dataset");
  assert.equal(update.overallConfidence, 0.88);
  assert.equal(update.indicators.length, 1);
  assert.equal(update.indicators[0]?.suggestedCalculation?.operation, "ratio");
  assert.equal(
    update.indicators[0]?.computedValue?.components
      ?.deterministicAnalysisMetricKey,
    "attendance::positive_status_ratio",
  );
  assert.equal(update.warnings.length, 2);
  assert.equal(update.goalAlignment[0]?.relatedIndicatorIds.length, 1);
});

test("skips synthesis until deterministic quantitative analysis is ready", async () => {
  const service = new QuantitativeInterpretationSynthesisService(
    {} as InterpretationResultRepository,
    {} as ProcessingJobRepository,
    {} as ActivityRepository,
    {} as ProjectRepository,
    {} as PythonProcessingClient,
  );

  const updated = await service.maybeSyncForInterpretationResult(
    makeResult(),
    makePreparation({
      preparedDataset: {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: false,
        unresolvedRequirements: ["Need primary status confirmation."],
        tables: [],
      },
    }),
    makeAnalysis({ status: "awaiting_preparation" }),
  );

  assert.equal(updated, null);
});

test("mixed dual-track synthesis preserves qualitative artifacts and adds reconciled quantitative indicators", async () => {
  let capturedUpdate: InterpretationResultSynthesisUpdateInput | null = null;
  let mixedSynthesisCallCount = 0;

  const interpretationResultRepository = {
    replaceSynthesisArtifacts: async (
      _interpretationResultId: string,
      input: InterpretationResultSynthesisUpdateInput,
    ) => {
      capturedUpdate = input;
      return makeResult({
        datasetType: input.datasetType,
        overallConfidence: input.overallConfidence,
      });
    },
  } as unknown as InterpretationResultRepository;

  const processingJobRepository = {
    findById: async () => ({
      id: "job-1",
      payload: { language: "en" },
    }),
  } as unknown as ProcessingJobRepository;

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity",
      description: null,
      activityType: null,
      owner: null,
      startDate: null,
      endDate: null,
      objectives: "Participants build confidence.",
      successIndicators: "Participants report stronger belonging.",
      targetAudience: null,
      additionalContext: null,
      status: "active",
      interpretationAcknowledgedAt: null,
      interpretationAcknowledgedById: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ActivityRepository;

  const projectRepository = {
    findById: async () => ({
      id: "project-1",
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Project",
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: "Participants attend mentoring sessions.",
        outcomes: "Participants report higher confidence.",
        impact: null,
      },
      successIndicators: "Confidence improvement",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ProjectRepository;

  const pythonProcessingClient = {
    synthesizeQuantitativeInterpretation: async () => {
      throw new Error(
        "Should not call quantitative synthesis for mixed evidence.",
      );
    },
    synthesizeMixedInterpretation: async () => {
      mixedSynthesisCallCount += 1;
      return {
        datasetType: "Mixed mentoring evidence",
        overallConfidence: 0.84,
        indicators: [
          {
            name: "Participant completion rate",
            description: "Share of participants marked as completed.",
            confidence: 0.9,
            reason:
              "Deterministic completion metric reconciled with narrative context.",
            relatedFields: ["status"],
            supportingParagraphKeys: [],
            relevanceStage: "outcome",
            matchesStatedGoal: true,
            suggestedCalculation: null,
            computedValue: {
              sourceKind: "computed_from_table",
              value: 0.8,
              unit: "ratio",
              components: {
                deterministicAnalysisMetricKey:
                  "attendance::positive_status_ratio",
              },
              recordsIncluded: 10,
              recordsExcluded: 0,
              groundingStatus: "passed",
            },
          },
        ],
        warnings: [
          {
            message:
              "Qualitative evidence complicates the completion metric because some participants described irregular attendance before completing.",
            severity: "warning",
          },
        ],
        goalAlignment: [
          {
            goalSummary: "Participants build confidence.",
            isSupportedByData: true,
            relatedIndicatorNames: ["Participant completion rate"],
            gapExplanation: null,
          },
        ],
      };
    },
  } as unknown as PythonProcessingClient;

  const service = new QuantitativeInterpretationSynthesisService(
    interpretationResultRepository,
    processingJobRepository,
    activityRepository,
    projectRepository,
    pythonProcessingClient,
  );

  const updated = await service.maybeSyncForInterpretationResult(
    makeResult({
      qualitativeFindings: [
        {
          id: "finding-1",
          summary: "Participants reported stronger confidence over time.",
          stage: "outcome",
          confidence: 0.86,
          reason:
            "Repeated participant reflections linked mentoring to confidence.",
          relatedEntityIds: [],
          relatedIndicatorIds: [],
          supportingQuoteIds: ["quote-1"],
          category: "outcome_support",
          outcomeReference: "Participants report higher confidence.",
          outcomeAnchorType: "project_outcome",
          relationToEvidence: "context_only",
          status: "kept",
        },
      ],
      supportingQuotes: [
        {
          id: "quote-1",
          excerptText: "I feel much more confident speaking up now.",
          excerptKind: "direct",
          speakerType: "participant",
          stage: "outcome",
          confidence: 0.82,
          reason: "Direct participant reflection on confidence.",
          sourceReference: "Interview paragraph 4",
          privacyMode: "verbatim_safe",
        },
      ],
    }),
    makePreparation({
      preparedDataset: {
        evidenceModality: "mixed_dual_track",
        isReadyForDeterministicAnalysis: true,
        unresolvedRequirements: [],
        tables: [
          {
            name: "attendance",
            rowCount: 10,
            columnCount: 2,
            selectedRowGrain: "One row is one participant.",
            identifierColumn: "participant_id",
            identifierHandling: "assume_unique",
            primaryStatusColumn: "status",
            primaryDateColumn: null,
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                role: "identifier",
                positiveStatusValues: [],
                positiveStatusDefinitionText: null,
                normalizationAccepted: null,
              },
              {
                name: "status",
                inferredType: "categorical",
                role: "primary_status",
                positiveStatusValues: ["completed"],
                positiveStatusDefinitionText: "completed is positive",
                normalizationAccepted: true,
              },
            ],
            notes: [],
          },
        ],
      },
    }),
    makeAnalysis(),
  );

  assert.ok(updated);
  assert.equal(mixedSynthesisCallCount, 1);
  if (capturedUpdate === null) {
    throw new Error("Expected synthesis update input.");
  }
  const update: InterpretationResultSynthesisUpdateInput = capturedUpdate;
  assert.equal(update.datasetType, "Mixed mentoring evidence");
  assert.equal(update.indicators.length, 1);
  assert.equal(update.qualitativeFindings.length, 1);
  assert.equal(update.supportingQuotes.length, 1);
  assert.equal(update.qualitativeFindings[0]?.category, "outcome_support");
  assert.equal(update.warnings.length, 2);
});
