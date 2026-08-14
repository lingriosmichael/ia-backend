import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";
import type { PythonProcessingClient } from "./pythonProcessingClient.js";
import type { QualitativeCodingReviewApproveInput } from "./qualitativeCodingReviewPersistence.js";
import type { QualitativeCodingReviewUpsertInput } from "./qualitativeCodingReviewPersistence.js";
import type { QualitativeCodingReviewRepository } from "./qualitativeCodingReviewRepository.js";
import { QualitativeCodingReviewService } from "./qualitativeCodingReviewService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";

function createService(overrides?: {
  uploadMetadataRepository?: Partial<UploadMetadataRepository>;
  authorizationService?: Partial<AuthorizationService>;
  privacySafeRepresentationRepository?: Partial<PrivacySafeRepresentationRepository>;
  interpretationResultRepository?: Partial<InterpretationResultRepository>;
  qualitativeCodingReviewRepository?: Partial<QualitativeCodingReviewRepository>;
  pythonProcessingClient?: Partial<PythonProcessingClient>;
}) {
  const uploadMetadataRepository = {
    findById: async () => ({
      id: "upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      sourceWorkbookUploadMetadataId: null,
      derivedSheetName: null,
      derivedSheetIndex: null,
      logicalEvidenceId: "logical-1",
      versionNumber: 1,
      replacesUploadMetadataId: null,
      supersededAt: null,
      originalFileName: "reflection.csv",
      contentType: "text/csv",
      sizeBytes: 123,
      storageKey: "files/reflection.csv",
      originalFileDeletedAt: null,
      status: "uploaded",
      uploadedById: "user-1",
      uploadedByName: "User",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      updatedAt: new Date("2026-08-11T10:00:00.000Z"),
    }),
    listByActivityIds: async () => [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        sourceWorkbookUploadMetadataId: null,
        derivedSheetName: null,
        derivedSheetIndex: null,
        logicalEvidenceId: "logical-1",
        versionNumber: 1,
        replacesUploadMetadataId: null,
        supersededAt: null,
        originalFileName: "reflection.csv",
        contentType: "text/csv",
        sizeBytes: 123,
        storageKey: "files/reflection.csv",
        originalFileDeletedAt: null,
        status: "uploaded",
        uploadedById: "user-1",
        uploadedByName: "User",
        createdAt: new Date("2026-08-11T10:00:00.000Z"),
        updatedAt: new Date("2026-08-11T10:00:00.000Z"),
      },
    ],
    ...(overrides?.uploadMetadataRepository ?? {}),
  } as unknown as UploadMetadataRepository;

  const authorizationService = {
    canViewProject: async () => undefined,
    canEditProject: async () => undefined,
    ...(overrides?.authorizationService ?? {}),
  } as unknown as AuthorizationService;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataId: async () => ({
      id: "psr-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      processingJobId: "job-1",
      privacyReviewId: "privacy-1",
      parsedRepresentationId: "parsed-1",
      payload: {
        tables: [
          {
            name: "feedback",
            rowCount: 3,
            rows: [
              { reflection_note: "I felt more prepared." },
              { reflection_note: "The mentor explained things clearly." },
              { reflection_note: "I still need more practice." },
            ],
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    ...(overrides?.privacySafeRepresentationRepository ?? {}),
  } as unknown as PrivacySafeRepresentationRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        id: "interpretation-1",
        uploadMetadataId: "upload-1",
        datasetProfile: {
          tableCount: 1,
          paragraphCount: 0,
          issues: [],
          tables: [
            {
              name: "feedback",
              rowCount: 3,
              columnCount: 1,
              likelyIdentifierColumns: [],
              likelyStatusColumns: [],
              likelyStageColumns: [],
              likelyDateColumns: [],
              likelyMeasureColumns: [],
              likelyFreeTextColumns: ["reflection_note"],
              likelySubgroupColumns: [],
              columns: [
                {
                  name: "reflection_note",
                  inferredType: "free_text",
                  nullCount: 0,
                  nonNullCount: 3,
                  uniqueValueCount: 3,
                  sampleValues: [],
                  minValue: null,
                  maxValue: null,
                  meanValue: null,
                  booleanTrueCount: null,
                  booleanFalseCount: null,
                  observedValues: [],
                  normalizedColumnName: "reflection_note",
                  duplicateNonNullValueCount: 0,
                  epistemicRole: "free_text",
                  isValidatedScaleCandidate: false,
                },
              ],
            },
          ],
        },
      },
    ],
    ...(overrides?.interpretationResultRepository ?? {}),
  } as unknown as InterpretationResultRepository;

  const qualitativeCodingReviewRepository = {
    findByUploadMetadataId: async () => ({
      id: "review-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      privacySafeRepresentationId: "psr-1",
      interpretationResultId: "interpretation-1",
      status: "pending",
      findings: {
        summary: [{ findingKey: "feedback::reflection_note" }],
      },
      decisions: null,
      approvedById: null,
      approvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    upsertByUploadMetadataId: async (
      input: QualitativeCodingReviewUpsertInput,
    ) => ({
      id: "review-1",
      organizationId: input.organizationId,
      projectId: input.projectId,
      activityId: input.activityId,
      uploadMetadataId: input.uploadMetadataId,
      privacySafeRepresentationId: input.privacySafeRepresentationId,
      interpretationResultId: input.interpretationResultId,
      status: "pending",
      findings: input.findings,
      decisions: null,
      approvedById: null,
      approvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    approveIfPending: async (
      _uploadMetadataId: string,
      input: QualitativeCodingReviewApproveInput,
    ) => ({
      id: "review-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      privacySafeRepresentationId: "psr-1",
      interpretationResultId: "interpretation-1",
      status: "approved",
      findings: {
        summary: [{ findingKey: "feedback::reflection_note" }],
      },
      decisions: input.decisions,
      approvedById: input.approvedById,
      approvedAt: input.approvedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    ...(overrides?.qualitativeCodingReviewRepository ?? {}),
  } as unknown as QualitativeCodingReviewRepository;

  const pythonProcessingClient = {
    proposeQualitativeCodingReview: async () => ({
      findings: [
        {
          findingKey: "feedback::reflection_note",
          tableName: "feedback",
          textColumnName: "reflection_note",
          syntheticCodeColumnName: "reflection_note_coded",
          rowCount: 3,
          nonEmptyRowCount: 3,
          sampleExcerpts: ["I felt more prepared."],
          existingCodeColumnNames: [],
          proposedCodes: [
            {
              code: "preparedness",
              label: "Preparedness",
              description: "Statements about feeling more prepared.",
              exampleExcerpts: ["I felt more prepared."],
            },
          ],
          proposedAssignments: [
            { rowIndex: 0, assignedCode: "preparedness" },
            { rowIndex: 1, assignedCode: "preparedness" },
            { rowIndex: 2, assignedCode: null },
          ],
          sourceCodebookUploadMetadataId: null,
          sourceCodebookOriginalFileName: null,
        },
      ],
      llmUsage: null,
    }),
    ...(overrides?.pythonProcessingClient ?? {}),
  } as unknown as PythonProcessingClient;

  const logger = {
    info: () => undefined,
  } as never;
  const noopLlmTokenLedgerService = {
    recordUsage: async () => undefined,
  } as never;

  return new QualitativeCodingReviewService(
    uploadMetadataRepository,
    authorizationService,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    qualitativeCodingReviewRepository,
    pythonProcessingClient,
    noopLlmTokenLedgerService,
    noopLlmTokenLedgerService,
    logger,
    false,
  );
}

test("generate persists the qualitative coding review proposal", async () => {
  const service = createService({
    qualitativeCodingReviewRepository: {
      findByUploadMetadataId: async () => null,
    },
  });

  const review = await service.generate("user-1", "upload-1", "de");

  assert.equal(review.status, "pending");
  assert.equal(review.uploadMetadataId, "upload-1");
  assert.deepEqual(review.findings.summary, [
    {
      findingKey: "feedback::reflection_note",
      tableName: "feedback",
      textColumnName: "reflection_note",
      syntheticCodeColumnName: "reflection_note_coded",
      rowCount: 3,
      nonEmptyRowCount: 3,
      sampleExcerpts: ["I felt more prepared."],
      existingCodeColumnNames: [],
      proposedCodes: [
        {
          code: "preparedness",
          label: "Preparedness",
          description: "Statements about feeling more prepared.",
          exampleExcerpts: ["I felt more prepared."],
        },
      ],
      proposedAssignments: [
        { rowIndex: 0, assignedCode: "preparedness" },
        { rowIndex: 1, assignedCode: "preparedness" },
        { rowIndex: 2, assignedCode: null },
      ],
      sourceCodebookUploadMetadataId: null,
      sourceCodebookOriginalFileName: null,
    },
  ]);
});

test("generate rejects a second call for an upload that already has a review, instead of silently regenerating it", async () => {
  // Regression test: there is no user-facing "regenerate" action today, so
  // a second generate() call for the same upload can only be an unintended
  // duplicate (e.g. a frontend race firing the auto-trigger twice). Since
  // regenerating always resets the review to "pending" and discards prior
  // decisions, a silent second call would wipe out real approval progress.
  let pythonCallCount = 0;
  const service = createService({
    pythonProcessingClient: {
      proposeQualitativeCodingReview: async () => {
        pythonCallCount += 1;
        return { findings: [], llmUsage: null };
      },
    },
  });

  await assert.rejects(
    service.generate("user-1", "upload-1", "de"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "qualitative_coding_review_already_exists",
  );
  assert.equal(
    pythonCallCount,
    0,
    "must not call the Python service when a review already exists",
  );
});

test("approve requires a decision for every qualitative coding finding", async () => {
  const service = createService();

  await assert.rejects(
    service.approve("user-1", "upload-1", undefined),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "qualitative_coding_review_decisions_incomplete",
  );
});

test("generate persists an empty review when no qualitative coding findings are proposed", async () => {
  const service = createService({
    qualitativeCodingReviewRepository: {
      findByUploadMetadataId: async () => null,
    },
    pythonProcessingClient: {
      proposeQualitativeCodingReview: async () => ({
        findings: [],
        llmUsage: null,
      }),
    },
  });

  const review = await service.generate("user-1", "upload-1", "de");

  assert.equal(review.status, "pending");
  assert.deepEqual(review.findings, { summary: [] });
});
