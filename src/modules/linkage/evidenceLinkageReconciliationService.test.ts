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
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
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
    synthesisStatus: null,
    synthesisError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeColumn(
  name: string,
  role: PreparedDatasetColumn["role"],
  positiveStatusValues: string[] = [],
): PreparedDatasetColumn {
  return {
    name,
    inferredType: role === "identifier" ? "identifier" : "categorical",
    role,
    positiveStatusValues,
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
  };
}

function makePreparation(
  id: string,
  interpretationResultId: string,
  tableName: string,
  columns: PreparedDatasetColumn[],
  primaryStatusColumn: string | null = null,
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
          primaryStatusColumn,
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
  record: ActivityEvidenceLinkageResultPersistenceRecord | null;
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
  concernTaggingInstruction?: string | null;
  concernTaggingResults?: Array<{
    entityKey: string;
    flagged: boolean;
    reason: string;
  }>;
}) {
  const capture: UpsertCapture & {
    concernTaggingRequests: unknown[];
  } = {
    input: null,
    record: null,
    deletedActivityIds: [],
    concernTaggingRequests: [],
  };

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
      capture.record = {
        id: "linkage-result-1",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      } as ActivityEvidenceLinkageResultPersistenceRecord;
      return capture.record;
    },
    findByActivityId: async () => capture.record,
    deleteByActivityId: async (activityId: string) => {
      capture.deletedActivityIds.push(activityId);
      capture.record = null;
      return 1;
    },
  } as unknown as ActivityEvidenceLinkageResultRepository;

  const logger = {
    info: () => {},
    error: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;

  const activityRepository = {
    findById: async () => ({
      concernTaggingInstruction: options.concernTaggingInstruction ?? null,
    }),
  } as unknown as ActivityRepository;

  const pythonProcessingClient = {
    runConcernTagging: async (input: unknown) => {
      capture.concernTaggingRequests.push(input);
      return { results: options.concernTaggingResults ?? [] };
    },
  } as unknown as PythonProcessingClient;

  const service = new EvidenceLinkageReconciliationService(
    uploadMetadataRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    activityEvidenceLinkageResultRepository,
    activityRepository,
    pythonProcessingClient,
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

test("stores name-like linkage matches as review proposals instead of auto-joining them", async () => {
  const columns = [makeColumn("schule", "subgroup")];
  const rowsA = [
    { schule: "Theodor-Heuss-Oberschule" },
    { schule: "Ernst-Reuter-Schule" },
    { schule: "Sophie-Scholl-Gymnasium" },
    { schule: "Anna-Seghers-Schule" },
    { schule: "Käthe-Kollwitz-Schule" },
  ];
  const rowsB = [...rowsA];

  const { service, capture } = makeService({
    uploadIds: ["upload-a", "upload-b"],
    results: [
      makeResult("result-a", "upload-a", "psr-a"),
      makeResult("result-b", "upload-b", "psr-b"),
    ],
    preparations: [
      makePreparation("prep-a", "result-a", "schultermine", columns),
      makePreparation("prep-b", "result-b", "anmeldungen", columns),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "schultermine", rowsA)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "anmeldungen", rowsB)],
    ]),
  });

  const result = await service.reconcileForActivity(ACTIVITY_ID);

  assert.ok(result);
  assert.equal(result.status, "needs_review");
  assert.ok(capture.input);
  assert.deepEqual(capture.input.groups, []);
  assert.equal(capture.input.proposals.length, 1);
  assert.equal(capture.input.proposals[0]?.columnNameA, "schule");
  assert.equal(capture.input.proposals[0]?.columnNameB, "schule");
  assert.deepEqual(capture.input.proposalDecisions, []);
});

test("rejecting a weak linkage proposal resolves the activity with separate files", async () => {
  const columns = [makeColumn("schule", "subgroup")];
  const rowsA = [
    { schule: "Theodor-Heuss-Oberschule" },
    { schule: "Ernst-Reuter-Schule" },
    { schule: "Sophie-Scholl-Gymnasium" },
    { schule: "Anna-Seghers-Schule" },
    { schule: "Käthe-Kollwitz-Schule" },
  ];
  const rowsB = [...rowsA];

  const { service } = makeService({
    uploadIds: ["upload-a", "upload-b"],
    results: [
      makeResult("result-a", "upload-a", "psr-a"),
      makeResult("result-b", "upload-b", "psr-b"),
    ],
    preparations: [
      makePreparation("prep-a", "result-a", "schultermine", columns),
      makePreparation("prep-b", "result-b", "anmeldungen", columns),
    ],
    privacySafeRepresentationsById: new Map([
      ["psr-a", makePrivacySafeRepresentation("psr-a", "schultermine", rowsA)],
      ["psr-b", makePrivacySafeRepresentation("psr-b", "anmeldungen", rowsB)],
    ]),
  });

  const initial = await service.reconcileForActivity(ACTIVITY_ID);
  const proposalId = initial?.proposals[0]?.proposalId;

  assert.ok(proposalId);

  const resolved = await service.reviewProposal(
    ACTIVITY_ID,
    proposalId,
    "reject",
  );

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.groups, []);
  assert.deepEqual(resolved.proposals, []);
  assert.equal(resolved.proposalDecisions.length, 1);
  assert.equal(resolved.proposalDecisions[0]?.decision, "reject");
});

test("concern tagging is skipped entirely, no LLM call, when the activity has no concernTaggingInstruction configured", async () => {
  const columns = [makeColumn("participant_id", "identifier")];
  const rowsA = makeIdentifierRows(["p-1", "p-2"]);
  const rowsB = makeIdentifierRows(["p-1", "p-2"]);

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
    // concernTaggingInstruction defaults to null via makeService.
  });

  await service.reconcileForActivity(ACTIVITY_ID);

  assert.equal(capture.concernTaggingRequests.length, 0);
});

test("concern tagging flows end to end into the generic cohort-flag-prevalence computation", async () => {
  const matrixColumns = [
    makeColumn("participant_id", "identifier"),
    makeColumn("empfehlung", "primary_status", ["geeignet"]),
  ];
  const notesColumns = [
    makeColumn("participant_id", "identifier"),
    makeColumn("remark", "free_text"),
  ];

  const matrixRows = [
    { participant_id: "p-1", empfehlung: "geeignet" },
    { participant_id: "p-2", empfehlung: "geeignet" },
    { participant_id: "p-3", empfehlung: "geeignet" },
    { participant_id: "p-4", empfehlung: "nicht geeignet" },
    { participant_id: "p-5", empfehlung: "nicht geeignet" },
  ];
  // p-2 has no remark at all — it must never reach the LLM, and must
  // never end up counted as flagged for lack of a "no" value either.
  const notesRows = [
    { participant_id: "p-1", remark: "Insists on meeting alone at home." },
    { participant_id: "p-2", remark: "" },
    { participant_id: "p-3", remark: "Great communicator, very reliable." },
    { participant_id: "p-4", remark: "" },
    { participant_id: "p-5", remark: "" },
  ];

  const { service, capture } = makeService({
    uploadIds: ["upload-matrix", "upload-notes"],
    results: [
      makeResult("result-matrix", "upload-matrix", "psr-matrix"),
      makeResult("result-notes", "upload-notes", "psr-notes"),
    ],
    preparations: [
      makePreparation(
        "prep-matrix",
        "result-matrix",
        "matrix",
        matrixColumns,
        "empfehlung",
      ),
      makePreparation("prep-notes", "result-notes", "notes", notesColumns),
    ],
    privacySafeRepresentationsById: new Map([
      [
        "psr-matrix",
        makePrivacySafeRepresentation("psr-matrix", "matrix", matrixRows),
      ],
      [
        "psr-notes",
        makePrivacySafeRepresentation("psr-notes", "notes", notesRows),
      ],
    ]),
    concernTaggingInstruction: "Flag any note suggesting a safety concern.",
    concernTaggingResults: [
      { entityKey: "p-1", flagged: true, reason: "Wants to meet alone." },
      { entityKey: "p-3", flagged: false, reason: "" },
    ],
  });

  const result = await service.reconcileForActivity(ACTIVITY_ID);

  assert.ok(result);
  assert.equal(capture.concernTaggingRequests.length, 1);
  const request = capture.concernTaggingRequests[0] as {
    entities: Array<{ entityKey: string; text: string }>;
  };
  // Only p-1 and p-3 have any remark text — p-2/p-4/p-5 must be excluded
  // from the request entirely, not sent with an empty string.
  assert.deepEqual(request.entities.map((entity) => entity.entityKey).sort(), [
    "p-1",
    "p-3",
  ]);

  assert.ok(capture.input);
  const [group] = capture.input.groups;
  assert.ok(group);

  const concernFlagDefinition = group.positiveStatusFieldDefinitions.find(
    (definition) => definition.fieldName === "concern_flag",
  );
  assert.ok(concernFlagDefinition);
  assert.deepEqual(concernFlagDefinition.positiveStatusValues, ["no"]);

  const { computeCohortFlagPrevalences } =
    await import("./linkageIndicatorCalculations.js");
  const prevalences = computeCohortFlagPrevalences(
    group.entities,
    group.positiveStatusFieldDefinitions,
  );
  const prevalence = prevalences.find(
    (candidate) => candidate.flagFieldName === "concern_flag",
  );
  assert.ok(prevalence);
  assert.equal(prevalence.cohortFieldName, "empfehlung");
  // p-1, p-2, p-3 are all "geeignet" — the full cohort, including p-2,
  // who never got a concern_flag field at all because it had no remark.
  assert.equal(prevalence.cohortSize, 3);
  // Only p-1 is actually flagged: p-3 was explicitly tagged false, and
  // p-2 has no concern_flag field to begin with — neither counts.
  assert.equal(prevalence.flaggedCount, 1);
  assert.deepEqual(prevalence.flaggedEntityKeys, ["p-1"]);
});
