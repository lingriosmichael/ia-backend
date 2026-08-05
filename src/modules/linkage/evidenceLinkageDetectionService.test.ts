import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceLinkageDetectionService } from "./evidenceLinkageDetectionService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { PreparedDatasetColumn } from "../../shared/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ACTIVITY_ID = "activity-1";

function makeUpload(
  overrides: Partial<UploadMetadataPersistenceRecord> = {},
): UploadMetadataPersistenceRecord {
  return {
    id: "upload-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    sourceWorkbookUploadMetadataId: null,
    derivedSheetName: null,
    derivedSheetIndex: null,
    uploadedById: "user-1",
    logicalEvidenceId: "evidence-1",
    versionNumber: 1,
    replacesUploadMetadataId: null,
    supersededAt: null,
    originalFileName: "file.csv",
    contentType: "text/csv",
    sizeBytes: 100,
    storageKey: "storage-key-1",
    originalFileDeletedAt: null,
    status: "uploaded",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<InterpretationResultPersistenceRecord> = {},
): InterpretationResultPersistenceRecord {
  return {
    id: "result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "psr-1",
    processingJobId: "job-1",
    versionNumber: 1,
    previousInterpretationResultId: null,
    datasetType: "roster",
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

function makeColumn(
  name: string,
  role: PreparedDatasetColumn["role"],
): PreparedDatasetColumn {
  return {
    name,
    inferredType: role === "identifier" ? "identifier" : "categorical",
    role,
    positiveStatusValues: [],
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
  };
}

function makePreparation(
  overrides: Partial<DatasetPreparationPersistenceRecord> = {},
  tableName: string,
  columns: PreparedDatasetColumn[],
): DatasetPreparationPersistenceRecord {
  return {
    id: "prep-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
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
          name: tableName,
          rowCount: 0,
          columnCount: columns.length,
          selectedRowGrain: null,
          identifierColumn:
            columns.find((column) => column.role === "identifier")?.name ??
            null,
          identifierHandling: "assume_unique",
          primaryStatusColumn: null,
          primaryDateColumn: null,
          columns,
          notes: [],
        },
      ],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makePrivacySafeRepresentation(
  id: string,
  tableName: string,
  rows: Record<string, unknown>[],
) {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    uploadMetadataId: "upload-1",
    processingJobId: "job-1",
    privacyReviewId: "review-1",
    parsedRepresentationId: "parsed-1",
    payload: {
      tables: [{ name: tableName, rows }],
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface Fixture {
  uploads: UploadMetadataPersistenceRecord[];
  results: InterpretationResultPersistenceRecord[];
  preparations: DatasetPreparationPersistenceRecord[];
  privacySafeRepresentationsById: Map<
    string,
    ReturnType<typeof makePrivacySafeRepresentation>
  >;
}

function makeService(fixture: Fixture) {
  const uploadMetadataRepository = {
    listByActivityIds: async () => fixture.uploads,
  } as unknown as UploadMetadataRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => fixture.results,
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async () => fixture.preparations,
  } as unknown as DatasetPreparationRepository;

  const privacySafeRepresentationRepository = {
    findById: async (id: string) =>
      fixture.privacySafeRepresentationsById.get(id) ?? null,
  } as unknown as PrivacySafeRepresentationRepository;

  const logger = {
    info: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;

  return new EvidenceLinkageDetectionService(
    uploadMetadataRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    logger,
  );
}

test("returns no candidates when the activity has fewer than two uploads", async () => {
  const service = makeService({
    uploads: [makeUpload({ id: "upload-1" })],
    results: [],
    preparations: [],
    privacySafeRepresentationsById: new Map(),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);
  assert.deepEqual(candidates, []);
});

test("proposes a high-confidence identifier-column candidate when identifier values overlap above the threshold", async () => {
  const rosterColumns = [
    makeColumn("participant_id", "identifier"),
    makeColumn("team", "subgroup"),
  ];
  const safeguardingColumns = [
    makeColumn("participant_id", "identifier"),
    makeColumn("flag_reason", "free_text"),
  ];

  const rosterRows = ["p-1", "p-2", "p-3", "p-4", "p-5"].map((id) => ({
    participant_id: id,
    team: "red",
  }));
  const safeguardingRows = ["p-1", "p-2", "p-3", "p-4", "p-5", "p-6"].map(
    (id) => ({
      participant_id: id,
      flag_reason: "pending review",
    }),
  );

  const service = makeService({
    uploads: [
      makeUpload({ id: "upload-roster" }),
      makeUpload({ id: "upload-safeguarding" }),
    ],
    results: [
      makeResult({
        id: "result-roster",
        uploadMetadataId: "upload-roster",
        privacySafeRepresentationId: "psr-roster",
      }),
      makeResult({
        id: "result-safeguarding",
        uploadMetadataId: "upload-safeguarding",
        privacySafeRepresentationId: "psr-safeguarding",
      }),
    ],
    preparations: [
      makePreparation(
        {
          id: "prep-roster",
          interpretationResultId: "result-roster",
          uploadMetadataId: "upload-roster",
        },
        "roster",
        rosterColumns,
      ),
      makePreparation(
        {
          id: "prep-safeguarding",
          interpretationResultId: "result-safeguarding",
          uploadMetadataId: "upload-safeguarding",
        },
        "safeguarding",
        safeguardingColumns,
      ),
    ],
    privacySafeRepresentationsById: new Map([
      [
        "psr-roster",
        makePrivacySafeRepresentation("psr-roster", "roster", rosterRows),
      ],
      [
        "psr-safeguarding",
        makePrivacySafeRepresentation(
          "psr-safeguarding",
          "safeguarding",
          safeguardingRows,
        ),
      ],
    ]),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.matchBasis, "identifier_column");
  assert.equal(candidate.confidence, "high");
  assert.equal(candidate.columnA.columnName, "participant_id");
  assert.equal(candidate.columnB.columnName, "participant_id");
  assert.equal(candidate.overlapRatio, 5 / 6);
});

test("falls back to a medium-confidence name-like candidate when no identifier columns overlap", async () => {
  const columnsWithoutIdentifier = [makeColumn("candidate_name", "free_text")];

  const uploadARows = ["anna", "bernd", "carla", "dieter", "erika"].map(
    (name) => ({ candidate_name: name }),
  );
  const uploadBRows = ["anna", "bernd", "carla", "dieter", "frank"].map(
    (name) => ({ candidate_name: name }),
  );

  const service = makeService({
    uploads: [makeUpload({ id: "upload-a" }), makeUpload({ id: "upload-b" })],
    results: [
      makeResult({
        id: "result-a",
        uploadMetadataId: "upload-a",
        privacySafeRepresentationId: "psr-a",
      }),
      makeResult({
        id: "result-b",
        uploadMetadataId: "upload-b",
        privacySafeRepresentationId: "psr-b",
      }),
    ],
    preparations: [
      makePreparation(
        { id: "prep-a", interpretationResultId: "result-a" },
        "table-a",
        columnsWithoutIdentifier,
      ),
      makePreparation(
        { id: "prep-b", interpretationResultId: "result-b" },
        "table-b",
        columnsWithoutIdentifier,
      ),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", uploadARows)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", uploadBRows)],
    ]),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.matchBasis, "name_like_column");
  assert.equal(candidate.confidence, "medium");
  assert.equal(candidate.overlapRatio, 4 / 6);
});

test("does not propose a candidate when identifier overlap is below the Jaccard threshold", async () => {
  const columns = [makeColumn("participant_id", "identifier")];

  const uploadARows = ["p-1", "p-2", "p-3", "p-4", "p-5"].map((id) => ({
    participant_id: id,
  }));
  const uploadBRows = ["p-3", "p-4", "p-5", "p-6", "p-7", "p-8", "p-9"].map(
    (id) => ({ participant_id: id }),
  );

  const service = makeService({
    uploads: [makeUpload({ id: "upload-a" }), makeUpload({ id: "upload-b" })],
    results: [
      makeResult({
        id: "result-a",
        uploadMetadataId: "upload-a",
        privacySafeRepresentationId: "psr-a",
      }),
      makeResult({
        id: "result-b",
        uploadMetadataId: "upload-b",
        privacySafeRepresentationId: "psr-b",
      }),
    ],
    preparations: [
      makePreparation(
        { id: "prep-a", interpretationResultId: "result-a" },
        "table-a",
        columns,
      ),
      makePreparation(
        { id: "prep-b", interpretationResultId: "result-b" },
        "table-b",
        columns,
      ),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", uploadARows)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", uploadBRows)],
    ]),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);
  assert.deepEqual(candidates, []);
});

test("ignores low-cardinality columns even when fully overlapping, to avoid coincidental matches", async () => {
  const columns = [makeColumn("has_flag", "free_text")];

  const rows = ["yes", "no"].map((value) => ({ has_flag: value }));

  const service = makeService({
    uploads: [makeUpload({ id: "upload-a" }), makeUpload({ id: "upload-b" })],
    results: [
      makeResult({
        id: "result-a",
        uploadMetadataId: "upload-a",
        privacySafeRepresentationId: "psr-a",
      }),
      makeResult({
        id: "result-b",
        uploadMetadataId: "upload-b",
        privacySafeRepresentationId: "psr-b",
      }),
    ],
    preparations: [
      makePreparation(
        { id: "prep-a", interpretationResultId: "result-a" },
        "table-a",
        columns,
      ),
      makePreparation(
        { id: "prep-b", interpretationResultId: "result-b" },
        "table-b",
        columns,
      ),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", rows)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", rows)],
    ]),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);
  assert.deepEqual(candidates, []);
});

test("skips uploads whose dataset preparation is not ready for deterministic analysis", async () => {
  const columns = [makeColumn("participant_id", "identifier")];
  const rows = ["p-1", "p-2", "p-3", "p-4", "p-5"].map((id) => ({
    participant_id: id,
  }));

  const service = makeService({
    uploads: [makeUpload({ id: "upload-a" }), makeUpload({ id: "upload-b" })],
    results: [
      makeResult({
        id: "result-a",
        uploadMetadataId: "upload-a",
        privacySafeRepresentationId: "psr-a",
      }),
      makeResult({
        id: "result-b",
        uploadMetadataId: "upload-b",
        privacySafeRepresentationId: "psr-b",
      }),
    ],
    preparations: [
      makePreparation(
        {
          id: "prep-a",
          interpretationResultId: "result-a",
          status: "awaiting_answers",
        },
        "table-a",
        columns,
      ),
      makePreparation(
        { id: "prep-b", interpretationResultId: "result-b" },
        "table-b",
        columns,
      ),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", rows)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", rows)],
    ]),
  });

  const candidates = await service.detectForActivity(ACTIVITY_ID);
  assert.deepEqual(candidates, []);
});
