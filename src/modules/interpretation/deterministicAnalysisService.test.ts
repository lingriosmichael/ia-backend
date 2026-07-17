import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import type { DeterministicAnalysisRepository } from "./deterministicAnalysisRepository.js";
import type { DeterministicAnalysisUpsertInput } from "./deterministicAnalysisPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "./datasetPreparationPersistence.js";
import type { InterpretationResultPersistenceRecord } from "./interpretationResultPersistence.js";

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
    datasetType: "attendance_log",
    overallConfidence: 0.9,
    evidenceRouting: null,
    datasetProfile: null,
    entities: [],
    indicators: [],
    relationships: [],
    qualitativeFindings: [],
    supportingQuotes: [],
    questions: [],
    warnings: [],
    goalAlignment: [],
    llmUsage: null,
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
    status: "ready_for_analysis",
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
          rowCount: 3,
          columnCount: 6,
          selectedRowGrain: "One row is one participant attendance record.",
          identifierColumn: "participant_id",
          identifierHandling: "assume_unique",
          primaryStatusColumn: "status",
          primaryDateColumn: "session_date",
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
              positiveStatusDefinitionText: "Treat completed as positive.",
              normalizationAccepted: true,
            },
            {
              name: "session_date",
              inferredType: "date",
              role: "primary_date",
              positiveStatusValues: [],
              positiveStatusDefinitionText: null,
              normalizationAccepted: null,
            },
            {
              name: "cohort",
              inferredType: "categorical",
              role: "subgroup",
              positiveStatusValues: [],
              positiveStatusDefinitionText: null,
              normalizationAccepted: null,
            },
            {
              name: "motivation_score",
              inferredType: "numeric",
              role: "measure",
              positiveStatusValues: [],
              positiveStatusDefinitionText: null,
              normalizationAccepted: null,
            },
            {
              name: "communication_score",
              inferredType: "numeric",
              role: "measure",
              positiveStatusValues: [],
              positiveStatusDefinitionText: null,
              normalizationAccepted: null,
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

function requireCapturedInput(
  value: DeterministicAnalysisUpsertInput | null,
): DeterministicAnalysisUpsertInput {
  if (!value) {
    throw new Error("Expected captured deterministic analysis input.");
  }
  return value;
}

test("builds deterministic quantitative analysis from a prepared dataset", async () => {
  let capturedInput: DeterministicAnalysisUpsertInput | null = null;

  const repository = {
    upsertByInterpretationResultId: async (
      input: DeterministicAnalysisUpsertInput,
    ) => {
      capturedInput = input;
      return {
        id: "analysis-1",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as DeterministicAnalysisRepository;

  const privacySafeRepresentationRepository = {
    findById: async () => ({
      id: "psr-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      processingJobId: "processing-1",
      privacyReviewId: "review-1",
      parsedRepresentationId: "parsed-1",
      payload: {
        tables: [
          {
            name: "attendance",
            columns: [
              "participant_id",
              "status",
              "session_date",
              "cohort",
              "motivation_score",
              "communication_score",
            ],
            rows: [
              {
                participant_id: "P-1",
                status: "completed",
                session_date: "2026-01-10",
                cohort: "A",
                motivation_score: 4,
                communication_score: 5,
              },
              {
                participant_id: "P-2",
                status: "completed",
                session_date: "2026-01-22",
                cohort: "B",
                motivation_score: 5,
                communication_score: 4,
              },
              {
                participant_id: "P-3",
                status: "pending",
                session_date: "2026-02-05",
                cohort: "A",
                motivation_score: 2,
                communication_score: 3,
              },
            ],
          },
        ],
      },
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new DeterministicAnalysisService(
    repository,
    privacySafeRepresentationRepository,
  );

  await service.syncForInterpretationResult(makeResult(), makePreparation());

  const input = requireCapturedInput(capturedInput);
  assert.equal(input.status, "ready");
  assert.equal(input.metrics.length, 12);
  assert.equal(input.candidateIndicators.length, 8);
  assert.equal(input.distributions.length, 2);
  assert.equal(input.trends.length, 1);
  assert.equal(input.subgroupBreakdowns.length, 1);
  assert.equal(input.categoricalCrosstabs.length, 1);
  assert.equal(input.numericCategorySummaries.length, 4);
  assert.equal(input.numericCorrelations.length, 1);

  const totalRowsMetric = input.metrics.find(
    (metric) => metric.metricKey === "attendance::total_rows",
  );
  assert.equal(totalRowsMetric?.value, 3);

  const positiveRatioMetric = input.metrics.find(
    (metric) => metric.metricKey === "attendance::positive_status_ratio",
  );
  assert.equal(positiveRatioMetric?.value, 2 / 3);

  assert.deepEqual(input.distributions[0]?.buckets, [
    { value: "completed", count: 2, ratio: 2 / 3 },
    { value: "pending", count: 1, ratio: 1 / 3 },
  ]);
  assert.deepEqual(input.trends[0]?.points, [
    {
      period: "2026-01",
      rowCount: 2,
      positiveCount: 2,
      positiveRatio: 1,
    },
    {
      period: "2026-02",
      rowCount: 1,
      positiveCount: 0,
      positiveRatio: 0,
    },
  ]);
  assert.deepEqual(input.subgroupBreakdowns[0]?.segments, [
    {
      value: "A",
      rowCount: 2,
      positiveCount: 1,
      positiveRatio: 0.5,
    },
    {
      value: "B",
      rowCount: 1,
      positiveCount: 1,
      positiveRatio: 1,
    },
  ]);

  assert.deepEqual(input.categoricalCrosstabs[0]?.cells, [
    { valueA: "completed", valueB: "A", count: 1, ratio: 1 / 3 },
    { valueA: "completed", valueB: "B", count: 1, ratio: 1 / 3 },
    { valueA: "pending", valueB: "A", count: 1, ratio: 1 / 3 },
    { valueA: "pending", valueB: "B", count: 0, ratio: 0 },
  ]);

  const motivationByStatus = input.numericCategorySummaries.find(
    (summary) =>
      summary.numericColumnName === "motivation_score" &&
      summary.categoryColumnName === "status",
  );
  assert.deepEqual(motivationByStatus?.groups, [
    {
      categoryValue: "completed",
      count: 2,
      min: 4,
      max: 5,
      mean: 4.5,
      median: 4.5,
      standardDeviation: 0.5,
      q1: 4.25,
      q3: 4.75,
    },
    {
      categoryValue: "pending",
      count: 1,
      min: 2,
      max: 2,
      mean: 2,
      median: 2,
      standardDeviation: 0,
      q1: 2,
      q3: 2,
    },
  ]);

  assert.deepEqual(input.numericCorrelations[0], {
    correlationKey:
      "attendance::motivation_score::communication_score::correlation",
    label: "motivation_score vs communication_score",
    tableName: "attendance",
    columnAName: "motivation_score",
    columnBName: "communication_score",
    completePairCount: 3,
    pearson: 0.6547,
    spearman: 0.5,
  });
});

test("marks deterministic analysis as awaiting preparation when the prepared dataset is not ready", async () => {
  let capturedInput: DeterministicAnalysisUpsertInput | null = null;

  const repository = {
    upsertByInterpretationResultId: async (
      input: DeterministicAnalysisUpsertInput,
    ) => {
      capturedInput = input;
      return {
        id: "analysis-2",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as DeterministicAnalysisRepository;

  const privacySafeRepresentationRepository = {
    findById: async () => ({
      id: "psr-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      processingJobId: "processing-1",
      privacyReviewId: "review-1",
      parsedRepresentationId: "parsed-1",
      payload: { tables: [] },
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new DeterministicAnalysisService(
    repository,
    privacySafeRepresentationRepository,
  );

  await service.syncForInterpretationResult(
    makeResult(),
    makePreparation({
      status: "awaiting_answers",
      preparedDataset: {
        evidenceModality: "structured_quantitative",
        isReadyForDeterministicAnalysis: false,
        unresolvedRequirements: [
          "Primary status column still needs confirmation.",
        ],
        tables: [],
      },
    }),
  );

  const input = requireCapturedInput(capturedInput);
  assert.equal(input.status, "awaiting_preparation");
  assert.equal(input.metrics.length, 0);
  assert.equal(input.distributions.length, 0);
  assert.equal(input.trends.length, 0);
  assert.equal(input.subgroupBreakdowns.length, 0);
  assert.equal(input.categoricalCrosstabs.length, 0);
  assert.equal(input.numericCategorySummaries.length, 0);
  assert.equal(input.numericCorrelations.length, 0);
  assert.equal(input.warnings.length, 1);
  assert.equal(
    input.warnings[0]?.message,
    "Primary status column still needs confirmation.",
  );
});

test("marks non-quantitative evidence as not applicable", async () => {
  let capturedInput: DeterministicAnalysisUpsertInput | null = null;

  const repository = {
    upsertByInterpretationResultId: async (
      input: DeterministicAnalysisUpsertInput,
    ) => {
      capturedInput = input;
      return {
        id: "analysis-3",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as DeterministicAnalysisRepository;

  const privacySafeRepresentationRepository = {
    findById: async () => ({
      id: "psr-2",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-2",
      processingJobId: "processing-2",
      privacyReviewId: "review-2",
      parsedRepresentationId: "parsed-2",
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new DeterministicAnalysisService(
    repository,
    privacySafeRepresentationRepository,
  );

  await service.syncForInterpretationResult(
    makeResult({
      id: "result-2",
      uploadMetadataId: "upload-2",
      privacySafeRepresentationId: "psr-2",
    }),
    makePreparation({
      id: "prep-2",
      uploadMetadataId: "upload-2",
      privacySafeRepresentationId: "psr-2",
      interpretationResultId: "result-2",
      preparedDataset: null,
    }),
  );

  const input = requireCapturedInput(capturedInput);
  assert.equal(input.status, "not_applicable");
  assert.equal(input.metrics.length, 0);
  assert.equal(input.distributions.length, 0);
  assert.equal(input.trends.length, 0);
  assert.equal(input.subgroupBreakdowns.length, 0);
  assert.equal(input.categoricalCrosstabs.length, 0);
  assert.equal(input.numericCategorySummaries.length, 0);
  assert.equal(input.numericCorrelations.length, 0);
});
