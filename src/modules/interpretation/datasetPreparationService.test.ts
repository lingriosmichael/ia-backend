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
    llmUsage: null,
    synthesisStatus: null,
    synthesisError: null,
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
          recommendedOption: null,
          recommendedConfidence: null,
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
          recommendedOption: null,
          recommendedConfidence: null,
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
          recommendedOption: null,
          recommendedConfidence: null,
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
                epistemicRole: "identifier",
                isValidatedScaleCandidate: false,
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
                epistemicRole: null,
                isValidatedScaleCandidate: false,
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
  assert.equal(quantitativeInput.blockingQuestionCount, 2);
  assert.equal(quantitativeInput.answeredBlockingQuestionCount, 1);
  assert.deepEqual(quantitativeInput.unansweredBlockingQuestionIds, [
    "question-3",
  ]);
  assert.equal(quantitativeInput.decisions.length, 1);
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
    [],
  );
});

test("keeps the top-ranked identifier column even when a duplicate_identifier_resolution answer targets a different, lower-ranked candidate", async () => {
  // Regression test for a real activity: a table can have more than one
  // likely-identifier column (here 'bewerbungs_id' and 'vorname'), but
  // only the one with duplicate values gets a duplicate_identifier_resolution
  // question. Answering that question used to make its target column
  // ('vorname') win as THE identifier for the whole table, silently
  // discarding 'bewerbungs_id' — which had no duplicates and therefore
  // never needed a question at all. That broke evidence-linkage matching
  // against a second upload whose identifier column was correctly
  // 'bewerbungs_id', since the two tables no longer agreed on which
  // column was the shared identifier.
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
            name: "mentor_bewerbungen_export_maerz_2026",
            rowCount: 4,
            columns: ["bewerbungs_id", "vorname"],
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
          prompt:
            "The likely identifier field 'vorname' contains duplicate values. Should rows with the same value be treated as multiple events, or as duplicates that count once?",
          kind: "single_choice",
          questionDomain: "preparation",
          options: [
            "Multiple events",
            "Duplicates / count once",
            "Needs manual review",
          ],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "duplicate_identifier_resolution",
          targetTableName: "mentor_bewerbungen_export_maerz_2026",
          targetColumnName: "vorname",
          status: "answered",
          answeredValue: "Duplicates / count once",
          answeredById: "user-1",
          answeredAt: NOW,
        },
      ],
      datasetProfile: {
        tableCount: 1,
        paragraphCount: 0,
        tables: [
          {
            name: "mentor_bewerbungen_export_maerz_2026",
            rowCount: 4,
            columnCount: 2,
            likelyIdentifierColumns: ["bewerbungs_id", "vorname"],
            likelyStatusColumns: [],
            likelyStageColumns: [],
            likelyDateColumns: [],
            likelyMeasureColumns: [],
            likelyFreeTextColumns: [],
            likelySubgroupColumns: [],
            columns: [
              {
                name: "bewerbungs_id",
                inferredType: "identifier",
                roleHints: ["likely_identifier"],
                nullPercentage: 0,
                distinctCount: 4,
                averageTextLength: 4,
                topValues: [{ value: "B001", count: 1 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 0,
                epistemicRole: "identifier",
                isValidatedScaleCandidate: false,
              },
              {
                name: "vorname",
                inferredType: "identifier",
                roleHints: ["likely_identifier"],
                nullPercentage: 0,
                distinctCount: 3,
                averageTextLength: 5,
                topValues: [{ value: "Klaus", count: 2 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 1,
                epistemicRole: "identifier",
                isValidatedScaleCandidate: false,
              },
            ],
          },
        ],
        issues: [],
      },
    }),
  );

  const quantitativeInput = requireCapturedInput(capturedInput);
  assert.ok(quantitativeInput.preparedDataset);
  if (!quantitativeInput.preparedDataset) {
    throw new Error("Expected prepared dataset snapshot.");
  }
  const table = quantitativeInput.preparedDataset.tables[0];
  assert.equal(table?.identifierColumn, "bewerbungs_id");
  assert.equal(table?.identifierHandling, "assume_unique");
  assert.equal(
    table?.columns.find((column) => column.name === "bewerbungs_id")?.role,
    "identifier",
  );
  assert.notEqual(
    table?.columns.find((column) => column.name === "vorname")?.role,
    "identifier",
  );
});

test("resolves plain-language epistemic_role_clarification answers to categorical", async () => {
  // Regression test: "bezirk" (district)-shaped columns used to have no
  // plain answer to this question. "Etwas anderes" is intentionally mapped
  // to the safe categorical path, so it is not treated as free text or a
  // person-made interpretation.
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
            name: "mentor_bewerbungen_export_maerz_2026",
            rowCount: 10,
            columns: ["bewerbungs_id", "bezirk"],
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
          prompt:
            "What does one row in the table 'mentor_bewerbungen_export_maerz_2026' represent?",
          kind: "free_text",
          questionDomain: "preparation",
          options: null,
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "row_grain",
          targetTableName: "mentor_bewerbungen_export_maerz_2026",
          targetColumnName: null,
          status: "answered",
          answeredValue: "One row is one applicant.",
          answeredById: "user-1",
          answeredAt: NOW,
        },
        {
          id: "question-2",
          prompt: "Was steht in der Spalte 'bezirk'?",
          kind: "single_choice",
          questionDomain: "preparation",
          options: [
            "Feste Auswahlwerte",
            "Freie Texte",
            "Einschätzung durch eine Person",
            "Etwas anderes",
          ],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "epistemic_role_clarification",
          targetTableName: "mentor_bewerbungen_export_maerz_2026",
          targetColumnName: "bezirk",
          status: "answered",
          answeredValue: "Etwas anderes",
          answeredById: "user-1",
          answeredAt: NOW,
        },
      ],
      datasetProfile: {
        tableCount: 1,
        paragraphCount: 0,
        tables: [
          {
            name: "mentor_bewerbungen_export_maerz_2026",
            rowCount: 10,
            columnCount: 2,
            likelyIdentifierColumns: ["bewerbungs_id"],
            likelyStatusColumns: [],
            likelyStageColumns: [],
            likelyDateColumns: [],
            likelyMeasureColumns: [],
            likelyFreeTextColumns: [],
            likelySubgroupColumns: [],
            columns: [
              {
                name: "bewerbungs_id",
                inferredType: "identifier",
                roleHints: ["likely_identifier"],
                nullPercentage: 0,
                distinctCount: 10,
                averageTextLength: 4,
                topValues: [{ value: "B001", count: 1 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 0,
                epistemicRole: "identifier",
                isValidatedScaleCandidate: false,
              },
              {
                name: "bezirk",
                inferredType: "categorical",
                roleHints: [],
                nullPercentage: 0,
                distinctCount: 3,
                averageTextLength: 8,
                topValues: [
                  { value: "Mitte", count: 4 },
                  { value: "Kreuzberg", count: 3 },
                ],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 7,
                epistemicRole: null,
                isValidatedScaleCandidate: false,
              },
            ],
          },
        ],
        issues: [],
      },
    }),
  );

  const quantitativeInput = requireCapturedInput(capturedInput);
  assert.ok(quantitativeInput.preparedDataset);
  if (!quantitativeInput.preparedDataset) {
    throw new Error("Expected prepared dataset snapshot.");
  }
  assert.equal(
    quantitativeInput.preparedDataset.tables[0]?.columns.find(
      (column) => column.name === "bezirk",
    )?.epistemicRole,
    "categorical",
  );
});

test("a stale epistemic_role_clarification question on a structural identifier column does not block readiness", async () => {
  // Regression test: shouldIgnoreInterpretationQuestion already hides this
  // stale question from the API and from workflow-stage blocking checks
  // (interpretationReviewState.ts), but datasetPreparationService used to
  // still count it as an unanswered preparation requirement via the raw
  // persisted isBlocking field. Since the question is now permanently
  // invisible to the user, that left status stuck at "awaiting_answers"
  // forever — deterministic analysis gates on status === "ready_for_analysis"
  // (deterministicAnalysisService.ts), so this was a silent, unrecoverable
  // deadlock for any activity carrying one of these stale questions.
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
            name: "anmeldungen_jugendliche",
            rowCount: 3,
            columns: ["teilnehmer_id", "vorname"],
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
          prompt: "Was steht in der Spalte 'vorname'?",
          kind: "single_choice",
          questionDomain: "preparation",
          options: [
            "Feste Auswahlwerte",
            "Freie Texte",
            "Einschätzung durch eine Person",
            "Etwas anderes",
          ],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "epistemic_role_clarification",
          targetTableName: "anmeldungen_jugendliche",
          targetColumnName: "vorname",
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
            name: "anmeldungen_jugendliche",
            rowCount: 3,
            columnCount: 2,
            likelyIdentifierColumns: ["teilnehmer_id"],
            likelyStatusColumns: [],
            likelyStageColumns: [],
            likelyDateColumns: [],
            likelyMeasureColumns: [],
            likelyFreeTextColumns: [],
            likelySubgroupColumns: [],
            columns: [
              {
                name: "teilnehmer_id",
                inferredType: "identifier",
                roleHints: ["likely_identifier"],
                nullPercentage: 0,
                distinctCount: 3,
                averageTextLength: 3,
                topValues: [{ value: "T-1", count: 1 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 0,
                epistemicRole: "identifier",
                isValidatedScaleCandidate: false,
              },
              {
                name: "vorname",
                inferredType: "identifier",
                roleHints: [],
                nullPercentage: 0,
                distinctCount: 3,
                averageTextLength: 5,
                topValues: [{ value: "Klaus", count: 1 }],
                numericSummary: null,
                dateSummary: null,
                duplicateNonNullValueCount: 0,
                // Stale record shape: an ambiguous epistemicRole is what
                // originally caused the question to be generated, before
                // interpretation_pipeline.py's structural-identifier-name
                // fix classified it as "identifier" outright.
                epistemicRole: null,
                isValidatedScaleCandidate: false,
              },
            ],
          },
        ],
        issues: [],
      },
    }),
  );

  const quantitativeInput = requireCapturedInput(capturedInput);
  assert.equal(quantitativeInput.status, "ready_for_analysis");
  assert.equal(quantitativeInput.blockingQuestionCount, 0);
  assert.equal(quantitativeInput.answeredBlockingQuestionCount, 0);
  assert.deepEqual(quantitativeInput.unansweredBlockingQuestionIds, []);
  assert.ok(quantitativeInput.preparedDataset);
  if (!quantitativeInput.preparedDataset) {
    throw new Error("Expected prepared dataset snapshot.");
  }
  assert.equal(
    quantitativeInput.preparedDataset.isReadyForDeterministicAnalysis,
    true,
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
