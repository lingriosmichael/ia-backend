import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceLinkageReconciliationService } from "./evidenceLinkageReconciliationService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { ActivityEvidenceLinkageResultRepository } from "./activityEvidenceLinkageResultRepository.js";
import type {
  ActivityEvidenceLinkageResultPersistenceRecord,
  ActivityEvidenceLinkageResultUpsertInput,
} from "./activityEvidenceLinkageResultPersistence.js";
import type { PreparedDatasetColumn } from "../../shared/contracts.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ACTIVITY_ID = "activity-1";

function makeUpload(id: string): UploadMetadataPersistenceRecord {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    sourceWorkbookUploadMetadataId: null,
    derivedSheetName: null,
    derivedSheetIndex: null,
    uploadedById: "user-1",
    logicalEvidenceId: `evidence-${id}`,
    versionNumber: 1,
    replacesUploadMetadataId: null,
    supersededAt: null,
    originalFileName: `${id}.csv`,
    contentType: "text/csv",
    sizeBytes: 100,
    storageKey: `storage-${id}`,
    originalFileDeletedAt: null,
    status: "uploaded",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeResult(
  id: string,
  uploadMetadataId: string,
  privacySafeRepresentationId: string,
): InterpretationResultPersistenceRecord {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    uploadMetadataId,
    privacySafeRepresentationId,
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
  id: string,
  interpretationResultId: string,
  tableName: string,
  columns: PreparedDatasetColumn[],
): DatasetPreparationPersistenceRecord {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId: ACTIVITY_ID,
    uploadMetadataId: "upload",
    privacySafeRepresentationId: "psr",
    interpretationResultId,
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
    uploadMetadataId: "upload",
    processingJobId: "job-1",
    privacyReviewId: "review-1",
    parsedRepresentationId: "parsed-1",
    payload: { tables: [{ name: tableName, rows }] },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeIdentifierRows(ids: string[]): Record<string, unknown>[] {
  return ids.map((id) => ({ participant_id: id }));
}

interface UpsertCapture {
  input: ActivityEvidenceLinkageResultUpsertInput | null;
  deletedActivityIds: string[];
}

function makeService(options: {
  uploadIds: string[];
  results: InterpretationResultPersistenceRecord[];
  preparations: DatasetPreparationPersistenceRecord[];
  privacySafeRepresentationsById: Map<
    string,
    ReturnType<typeof makePrivacySafeRepresentation>
  >;
}) {
  const capture: UpsertCapture = { input: null, deletedActivityIds: [] };

  const uploadMetadataRepository = {
    listByActivityIds: async () => options.uploadIds.map(makeUpload),
  } as unknown as UploadMetadataRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => options.results,
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async () => options.preparations,
  } as unknown as DatasetPreparationRepository;

  const privacySafeRepresentationRepository = {
    findById: async (id: string) =>
      options.privacySafeRepresentationsById.get(id) ?? null,
  } as unknown as PrivacySafeRepresentationRepository;

  const activityEvidenceLinkageResultRepository = {
    upsertByActivityId: async (
      input: ActivityEvidenceLinkageResultUpsertInput,
    ) => {
      capture.input = input;
      return {
        id: "linkage-result-1",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      } as ActivityEvidenceLinkageResultPersistenceRecord;
    },
    deleteByActivityId: async (activityId: string) => {
      capture.deletedActivityIds.push(activityId);
      return 1;
    },
  } as unknown as ActivityEvidenceLinkageResultRepository;

  const logger = {
    info: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;

  const service = new EvidenceLinkageReconciliationService(
    uploadMetadataRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    activityEvidenceLinkageResultRepository,
    logger,
  );

  return { service, capture };
}

test("persists a joined entity table when two uploads share an identifier column", async () => {
  const columns = [makeColumn("participant_id", "identifier")];
  const rowsA = makeIdentifierRows(["p-1", "p-2", "p-3", "p-4", "p-5"]);
  const rowsB = makeIdentifierRows(["p-1", "p-2", "p-3", "p-4", "p-6"]);

  const { service, capture } = makeService({
    uploadIds: ["upload-a", "upload-b"],
    results: [
      makeResult("result-a", "upload-a", "psr-a"),
      makeResult("result-b", "upload-b", "psr-b"),
    ],
    preparations: [
      makePreparation("prep-a", "result-a", "table-a", columns),
      makePreparation("prep-b", "result-b", "table-b", columns),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", rowsA)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", rowsB)],
    ]),
  });

  const result = await service.reconcileForActivity(ACTIVITY_ID);

  assert.ok(result);
  assert.ok(capture.input);
  assert.equal(capture.input.activityId, ACTIVITY_ID);
  assert.equal(capture.input.groups.length, 1);
  assert.equal(capture.input.groups[0]?.entities.length, 6);
  assert.equal(capture.deletedActivityIds.length, 0);
});

test("deletes any existing linkage result when the activity no longer has anything to join", async () => {
  const { service, capture } = makeService({
    uploadIds: ["upload-a"],
    results: [],
    preparations: [],
    privacySafeRepresentationsById: new Map(),
  });

  const result = await service.reconcileForActivity(ACTIVITY_ID);

  assert.equal(result, null);
  assert.equal(capture.input, null);
  assert.deepEqual(capture.deletedActivityIds, [ACTIVITY_ID]);
});

test("persists an empty-groups record (not a delete) when two fully-interpreted uploads share nothing linkable", async () => {
  // Distinguishes "reconciliation ran for this activity and found nothing
  // to join" from "reconciliation never ran" — the signal
  // generateActivityAiKnowledge's §11 gate depends on (see the design
  // doc's implementation note).
  const columns = [makeColumn("participant_id", "identifier")];
  const rowsA = makeIdentifierRows(["p-1", "p-2", "p-3", "p-4", "p-5"]);
  const rowsB = makeIdentifierRows(["q-1", "q-2", "q-3", "q-4", "q-5"]);

  const { service, capture } = makeService({
    uploadIds: ["upload-a", "upload-b"],
    results: [
      makeResult("result-a", "upload-a", "psr-a"),
      makeResult("result-b", "upload-b", "psr-b"),
    ],
    preparations: [
      makePreparation("prep-a", "result-a", "table-a", columns),
      makePreparation("prep-b", "result-b", "table-b", columns),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "table-a", rowsA)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "table-b", rowsB)],
    ]),
  });

  const result = await service.reconcileForActivity(ACTIVITY_ID);

  assert.ok(result);
  assert.ok(capture.input);
  assert.deepEqual(capture.input.groups, []);
  assert.equal(capture.deletedActivityIds.length, 0);
});
