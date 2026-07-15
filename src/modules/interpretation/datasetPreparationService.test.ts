import assert from "node:assert/strict";
import test from "node:test";
import { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import type { DatasetPreparationUpsertInput } from "./datasetPreparationPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function requireCapturedInput(
  value: DatasetPreparationUpsertInput | null,
): DatasetPreparationUpsertInput {
  if (!value) {
    throw new Error("Expected captured preparation input.");
  }
  return value;
}

test("syncs quantitative preparation answers into a persisted preparation artifact", async () => {
  let capturedInput: DatasetPreparationUpsertInput | null = null;

  const repository = {
    upsertByInterpretationResultId: async (
      input: DatasetPreparationUpsertInput,
    ) => {
      capturedInput = input;
      return {
        id: "prep-1",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as DatasetPreparationRepository;

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
        metadata: { evidenceModality: "structured_quantitative" },
        tables: [
          {
            name: "attendance",
            rowCount: 2,
            columns: ["participant_id", "status"],
          },
        ],
      },
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new DatasetPreparationService(
    repository,
    privacySafeRepresentationRepository,
  );

  await service.syncForInterpretationResult(
    makeResult({
      questions: [
        {
          id: "question-1",
          prompt: "What does one row in the table 'attendance' represent?",
          kind: "free_text",
          questionDomain: "preparation",
          options: null,
          isBlocking: true,
          questionCode: "row_grain",
          targetTableName: "attendance",
          targetColumnName: null,
          status: "answered",
          answeredValue: "One row is one session attendance record.",
          answeredById: "user-1",
          answeredAt: NOW,
        },
        {
          id: "question-2",
          prompt:
            "Which values in the field 'status' should be treated as positive?",
          kind: "free_text",
          questionDomain: "preparation",
          options: null,
          isBlocking: true,
          questionCode: "positive_status_values",
          targetTableName: "attendance",
          targetColumnName: "status",
          status: "answered",
          answeredValue: "completed",
          answeredById: "user-1",
          answeredAt: NOW,
        },
        {
          id: "question-3",
          prompt:
            "In the field 'status', do these values all mean the same thing: 'completed', 'complete'?",
          kind: "merge_confirmation",
          questionDomain: "preparation",
          options: ["Yes, treat as one", "No, keep them separate"],
          isBlocking: true,
          questionCode: "normalization_merge",
          targetTableName: "attendance",
          targetColumnName: "status",
          status: "pending",
          answeredValue: null,
          answeredById: null,
          answeredAt: null,
        },
      ],
      datasetProfile: {
        tableCount: 1,
        paragraphCount: 0,
        tables: [
          {
            name: "attendance",
            rowCount: 2,
            columnCount: 2,
            likelyIdentifierColumns: ["participant_id"],
            likelyStatusColumns: ["status"],
            likelyStageColumns: [],
            likelyDateColumns: [],
            likelyMeasureColumns: [],
            likelyFreeTextColumns: [],
            likelySubgroupColumns: [],
            columns: [
              {
                name: "participant_id",
                inferredType: "identifier",
                roleHints: ["likely_identifier"],
                nullPercentage: 0,
                distinctCount: 1,
                averageTextLength: 3,
                topValues: [{ value: "P-1", count: 2 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 1,
              },
              {
                name: "status",
                inferredType: "categorical",
                roleHints: ["likely_status"],
                nullPercentage: 0,
                distinctCount: 2,
                averageTextLength: 8,
                topValues: [
                  { value: "completed", count: 1 },
                  { value: "pending", count: 1 },
                ],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 0,
              },
            ],
          },
        ],
        issues: [],
      },
    }),
  );

  const quantitativeInput = requireCapturedInput(capturedInput);
  assert.equal(quantitativeInput.status, "awaiting_answers");
  assert.equal(quantitativeInput.blockingQuestionCount, 3);
  assert.equal(quantitativeInput.answeredBlockingQuestionCount, 2);
  assert.deepEqual(quantitativeInput.unansweredBlockingQuestionIds, [
    "question-3",
  ]);
  assert.equal(quantitativeInput.decisions.length, 2);
  assert.equal(
    quantitativeInput.decisionSummary.rowGrains[0]?.tableName,
    "attendance",
  );
  assert.equal(
    quantitativeInput.decisionSummary.rowGrains[0]?.value,
    "One row is one session attendance record.",
  );
  assert.ok(quantitativeInput.preparedDataset);
  if (!quantitativeInput.preparedDataset) {
    throw new Error("Expected prepared dataset snapshot.");
  }
  assert.equal(
    quantitativeInput.preparedDataset.isReadyForDeterministicAnalysis,
    false,
  );
  assert.equal(
    quantitativeInput.preparedDataset.tables[0]?.identifierHandling,
    "assume_unique",
  );
  assert.deepEqual(
    quantitativeInput.preparedDataset.tables[0]?.columns.find(
      (column) => column.name === "status",
    )?.positiveStatusValues,
    ["completed"],
  );
});

test("marks non-quantitative evidence as not applicable", async () => {
  let capturedInput: DatasetPreparationUpsertInput | null = null;

  const repository = {
    upsertByInterpretationResultId: async (
      input: DatasetPreparationUpsertInput,
    ) => {
      capturedInput = input;
      return {
        id: "prep-2",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as DatasetPreparationRepository;

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
      payload: { metadata: { evidenceModality: "narrative_qualitative" } },
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new DatasetPreparationService(
    repository,
    privacySafeRepresentationRepository,
  );

  await service.syncForInterpretationResult(makeResult());

  const narrativeInput = requireCapturedInput(capturedInput);
  assert.equal(narrativeInput.status, "not_applicable");
  assert.equal(narrativeInput.blockingQuestionCount, 0);
  assert.equal(narrativeInput.preparedDataset, null);
});
