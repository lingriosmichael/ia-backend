import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "../interpretation/activityAnalysisV2ToolTypes.js";
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import type { OutcomeEvidenceCandidateCatalogDependencies } from "./outcomeEvidenceCandidateCatalogBuilder.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "./outcomeEvidenceLinkPersistence.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { OutcomeEvidenceRecommendation } from "./outcomeEvidenceRecommendationService.js";
import { OutcomeEvidenceRecommendationApprovalService } from "./outcomeEvidenceRecommendationApprovalService.js";

const NOW = new Date("2026-08-27T10:00:00.000Z");

function column(name: string, epistemicRole: string | null = null) {
  return {
    name,
    inferredType: null,
    role: "measure" as const,
    positiveStatusValues: [],
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
    epistemicRole,
  };
}

interface Fixture {
  service: OutcomeEvidenceRecommendationApprovalService;
  createdLinks: OutcomeEvidenceLinkPersistenceRecord[];
  executeCalls: ActivityAnalysisV2ToolRequest[][];
}

function createFixture(options?: {
  cohortTagBefore?: string | null;
  cohortTagAfter?: string | null;
  beforeIdentifierColumn?: string | null;
  afterIdentifierColumn?: string | null;
  beforeRows?: Array<Record<string, unknown>>;
  afterRows?: Array<Record<string, unknown>>;
  qualitativeCodingReviews?: Array<Record<string, unknown>>;
  executeImpl?: (
    requests: ActivityAnalysisV2ToolRequest[],
  ) => ActivityAnalysisV2CalculationRecord[];
}): Fixture {
  const activityRepository = {
    async findById(activityId: string) {
      return activityId === "activity-merged"
        ? { id: "activity-merged", projectId: "project-1" }
        : null;
    },
  } as unknown as ActivityRepository;

  // Two uploads, not one workbook internally holding both tables: datasetRole
  // is tracked per upload (OUTCOME_EVIDENCE_MERGE_PLAN.md's pre/post
  // inversion fix), matching how a multi-sheet workbook actually reaches
  // this service in production — split into separate derived-sheet uploads
  // before interpretation, never left as one upload spanning both waves.
  const uploads = [
    { id: "upload-1", activityId: "activity-merged", datasetRole: "baseline" },
    { id: "upload-2", activityId: "activity-merged", datasetRole: "followup" },
  ];
  const results = [
    { id: "result-1", uploadMetadataId: "upload-1" },
    { id: "result-2", uploadMetadataId: "upload-2" },
  ];
  const preparations = [
    {
      interpretationResultId: "result-1",
      status: "ready_for_analysis",
      preparedDataset: {
        isReadyForDeterministicAnalysis: true,
        tables: [
          {
            name: "wirkungsmessung",
            identifierColumn: options?.beforeIdentifierColumn ?? "antwort_id",
            cohortTag: options?.cohortTagBefore ?? null,
            columns: [
              column("antwort_id", "identifier"),
              column("teilnehmer_id", "identifier"),
              column("q3_vorher", "validated_scale"),
              column("besuchsgrund", "categorical"),
              column("status_vorher", "categorical"),
              column("feedback_vorher", "free_text"),
            ],
          },
        ],
      },
    },
    {
      interpretationResultId: "result-2",
      status: "ready_for_analysis",
      preparedDataset: {
        isReadyForDeterministicAnalysis: true,
        tables: [
          {
            name: "wirkungsmessung_zweite_tabelle",
            identifierColumn:
              options?.afterIdentifierColumn ??
              options?.beforeIdentifierColumn ??
              "antwort_id",
            cohortTag:
              options?.cohortTagAfter ?? options?.cohortTagBefore ?? null,
            columns: [
              column("antwort_id", "identifier"),
              column("teilnehmer_id", "identifier"),
              column("q3_nachher", "validated_scale"),
              column("status_nachher", "categorical"),
              column("feedback_nachher", "free_text"),
            ],
          },
        ],
      },
    },
  ];
  const privacySafeRepresentations = [
    {
      uploadMetadataId: "upload-1",
      payload: {
        tables: [
          {
            name: "wirkungsmessung",
            rows: options?.beforeRows ?? [
              {
                antwort_id: "antwort-1",
                teilnehmer_id: "teilnehmer-1",
                q3_vorher: 2,
                besuchsgrund: "Austausch",
                status_vorher: "ja",
                feedback_vorher: "Mehr Mut",
              },
              {
                antwort_id: "antwort-2",
                teilnehmer_id: "teilnehmer-2",
                q3_vorher: 4,
                besuchsgrund: "Beratung",
                status_vorher: "nein",
                feedback_vorher: "Mehr Orientierung",
              },
            ],
          },
        ],
      },
    },
    {
      uploadMetadataId: "upload-2",
      payload: {
        tables: [
          {
            name: "wirkungsmessung_zweite_tabelle",
            rows: options?.afterRows ?? [
              {
                antwort_id: "antwort-9",
                teilnehmer_id: "teilnehmer-1",
                q3_nachher: 3,
                status_nachher: "nein",
                feedback_nachher: "Weniger Zweifel",
              },
              {
                antwort_id: "antwort-10",
                teilnehmer_id: "teilnehmer-2",
                q3_nachher: 5,
                status_nachher: "ja",
                feedback_nachher: "Mehr Ziele",
              },
            ],
          },
        ],
      },
    },
  ];

  const candidateCatalogDependencies = {
    uploadMetadataRepository: {
      listByActivity: async (activityId: string) =>
        uploads.filter((upload) => upload.activityId === activityId),
    },
    interpretationResultRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        results.filter((result) =>
          uploadMetadataIds.includes(result.uploadMetadataId),
        ),
    },
    datasetPreparationRepository: {
      findByInterpretationResultIds: async (
        interpretationResultIds: string[],
      ) =>
        preparations.filter((preparation) =>
          interpretationResultIds.includes(preparation.interpretationResultId),
        ),
    },
    privacySafeRepresentationRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        privacySafeRepresentations.filter((representation) =>
          uploadMetadataIds.includes(representation.uploadMetadataId),
        ),
    },
    qualitativeCodingReviewRepository: {
      findByUploadMetadataIds: async () =>
        options?.qualitativeCodingReviews ?? [],
    },
  } as unknown as OutcomeEvidenceCandidateCatalogDependencies;

  const currentActivityEvidenceLoader = {
    async load(activityId: string) {
      return {
        organizationId: "org-1",
        projectId: "project-1",
        activityId,
        evidence: [
          {
            uploadMetadataId: "upload-1",
            privacySafeRepresentationId: "psr-1",
            logicalEvidenceId: "logical-1",
            versionNumber: 1,
            originalFileName: "outcome-evidence-baseline.xlsx",
            evidenceModality: "tabular",
            uploadedAt: NOW,
            payload: privacySafeRepresentations[0]?.payload ?? {},
          },
          {
            uploadMetadataId: "upload-2",
            privacySafeRepresentationId: "psr-2",
            logicalEvidenceId: "logical-2",
            versionNumber: 1,
            originalFileName: "outcome-evidence-followup.xlsx",
            evidenceModality: "tabular",
            uploadedAt: NOW,
            payload: privacySafeRepresentations[1]?.payload ?? {},
          },
        ],
        missingPrivacySafeUploads: [],
      };
    },
  } as unknown as CurrentActivityEvidenceLoader;

  const executeCalls: ActivityAnalysisV2ToolRequest[][] = [];
  const activityAnalysisV2ToolExecutor = {
    async execute(requests: ActivityAnalysisV2ToolRequest[]) {
      executeCalls.push(requests);
      const calculations = options?.executeImpl
        ? options.executeImpl(requests)
        : requests.map((request) => defaultCalculation(requests, request));
      return { toolCallTrace: [], qualitativeFindings: [], calculations };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const createdLinks: OutcomeEvidenceLinkPersistenceRecord[] = [];
  const outcomeEvidenceLinkRepository = {
    async create(input: Record<string, unknown>) {
      const record = {
        ...input,
        linkId: `link-${createdLinks.length + 1}`,
        createdAt: NOW,
        updatedAt: NOW,
      } as OutcomeEvidenceLinkPersistenceRecord;
      createdLinks.push(record);
      return record;
    },
    async listByProjectId() {
      return createdLinks;
    },
    async deleteByActivityId() {
      const removedCount = createdLinks.length;
      createdLinks.length = 0;
      return removedCount;
    },
  } as unknown as OutcomeEvidenceLinkRepository;

  const outcomeStatement: ProjectOutcomeStatementPersistenceRecord = {
    id: "outcome-1",
    projectId: "project-1",
    organizationId: "org-1",
    term: "short",
    statement: "Jugendliche kennen ihre naechsten Schritte.",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const projectOutcomeStatementRepository = {
    async findById(outcomeStatementId: string) {
      return outcomeStatementId === outcomeStatement.id
        ? outcomeStatement
        : null;
    },
  } as unknown as ProjectOutcomeStatementRepository;

  const authorizationService = {
    async canEditProject(_userId: string, projectId: string) {
      return { project: { id: projectId, organizationId: "org-1" } };
    },
  } as unknown as AuthorizationService;

  const service = new OutcomeEvidenceRecommendationApprovalService(
    authorizationService,
    activityRepository,
    candidateCatalogDependencies,
    currentActivityEvidenceLoader,
    activityAnalysisV2ToolExecutor,
    outcomeEvidenceLinkRepository,
    projectOutcomeStatementRepository,
  );

  return { service, createdLinks, executeCalls };
}

function extractMatchKey(
  requests: ActivityAnalysisV2ToolRequest[],
): string | null {
  const joinRequest = requests.find(
    (request) => request.toolName === "join_tables",
  ) as
    | (ActivityAnalysisV2ToolRequest & {
        arguments: { keys?: Array<{ leftColumnName?: string }> };
      })
    | undefined;
  return joinRequest?.arguments.keys?.[0]?.leftColumnName ?? null;
}

function defaultCalculation(
  requests: ActivityAnalysisV2ToolRequest[],
  request: ActivityAnalysisV2ToolRequest,
): ActivityAnalysisV2CalculationRecord {
  const matchKey = extractMatchKey(requests);
  const result =
    request.toolName === "paired_change"
      ? matchKey === "teilnehmer_id"
        ? { pairedCount: 2, meanPre: 2.0, meanPost: 3.0 }
        : { pairedCount: 0, meanPre: 0, meanPost: 0 }
      : request.toolName === "paired_category_shift"
        ? matchKey === "teilnehmer_id"
          ? {
              pairedCount: 2,
              beforeCounts: [
                { label: "ja", count: 1 },
                { label: "nein", count: 1 },
              ],
              afterCounts: [
                { label: "ja", count: 1 },
                { label: "nein", count: 1 },
              ],
            }
          : { pairedCount: 0, beforeCounts: [], afterCounts: [] }
        : request.toolName === "group_count"
          ? { groups: [{ value: "a", count: 2 }] }
          : {};
  return {
    calculationId: `${request.toolName}-1`,
    toolName:
      request.toolName as ActivityAnalysisV2CalculationRecord["toolName"],
    label: request.toolName,
    description: request.toolName,
    formula: null,
    value:
      request.toolName === "count_rows"
        ? 2
        : request.toolName === "join_tables" && matchKey === "teilnehmer_id"
          ? 2
          : 0,
    unit: null,
    sourceUploadMetadataIds: [],
    sourceTableNames: [],
    sourceColumns: [],
    result,
  };
}

const pairedDeltaRecommendation: Extract<
  OutcomeEvidenceRecommendation,
  { shape: "paired_delta" }
> = {
  shape: "paired_delta",
  before: {
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    columnName: "q3_vorher",
    label: "Q3 vorher",
    cohortTag: null,
    datasetRole: "baseline",
  },
  after: {
    uploadMetadataId: "upload-2",
    tableName: "wirkungsmessung_zweite_tabelle",
    columnName: "q3_nachher",
    label: "Q3 nachher",
    cohortTag: null,
    datasetRole: "followup",
  },
  outcomeId: "outcome-1",
  rationale: "Same scale, asked twice.",
};

const singleDistributionRecommendation: Extract<
  OutcomeEvidenceRecommendation,
  { shape: "single_distribution" }
> = {
  shape: "single_distribution",
  column: {
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    columnName: "besuchsgrund",
    label: "Besuchsgrund",
    cohortTag: null,
    datasetRole: "baseline",
  },
  outcomeId: "outcome-1",
  rationale: "Category breakdown.",
};

const pairedCategoricalShiftRecommendation: Extract<
  OutcomeEvidenceRecommendation,
  { shape: "paired_categorical_shift" }
> = {
  shape: "paired_categorical_shift",
  before: {
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    columnName: "status_vorher",
    label: "Status vorher",
    cohortTag: null,
    datasetRole: "baseline",
  },
  after: {
    uploadMetadataId: "upload-2",
    tableName: "wirkungsmessung_zweite_tabelle",
    columnName: "status_nachher",
    label: "Status nachher",
    cohortTag: null,
    datasetRole: "followup",
  },
  outcomeId: "outcome-1",
  rationale: "Same fixed-response status question, asked twice.",
};

const pairedSubjectiveCodeShiftRecommendation: Extract<
  OutcomeEvidenceRecommendation,
  { shape: "paired_categorical_shift" }
> = {
  shape: "paired_categorical_shift",
  before: {
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    columnName: "feedback_vorher_coded",
    label: "Feedback vorher coded",
    cohortTag: null,
    datasetRole: "baseline",
  },
  after: {
    uploadMetadataId: "upload-2",
    tableName: "wirkungsmessung_zweite_tabelle",
    columnName: "feedback_nachher_coded",
    label: "Feedback nachher coded",
    cohortTag: null,
    datasetRole: "followup",
  },
  outcomeId: "outcome-1",
  rationale: "Approved qualitative themes reused across both waves.",
};

test("approves a well-formed paired_delta recommendation, resolves the join, and persists a real link", async () => {
  const { service, createdLinks, executeCalls } = createFixture();

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedDeltaRecommendation,
  );

  assert.equal(link.shape, "paired_delta");
  assert.equal(createdLinks.length, 1);
  assert.equal(
    executeCalls.flat().some((request) => request.toolName === "join_tables"),
    true,
  );
  assert.equal(
    executeCalls.flat().some((request) => request.toolName === "paired_change"),
    true,
  );
  if (link.shape === "paired_delta") {
    assert.equal(link.matchKey, "teilnehmer_id");
    assert.deepEqual(link.matchDiagnostics, {
      matchedCount: 2,
      baselineCount: 2,
      comparisonCount: 2,
      matchedRatio: 1,
      candidateKeysConsidered: ["teilnehmer_id"],
    });
    assert.equal(link.pairingGroupKey, "q3_vorher");
  }
});

test("approves a well-formed single_distribution recommendation and resolves it via group_count", async () => {
  const { service, createdLinks, executeCalls } = createFixture();

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    singleDistributionRecommendation,
  );

  assert.equal(link.shape, "single_distribution");
  assert.equal(createdLinks.length, 1);
  assert.equal(
    executeCalls.flat().some((request) => request.toolName === "group_count"),
    true,
  );
});

test("approves a fixed-domain paired_categorical_shift recommendation and persists compatibility diagnostics", async () => {
  const { service, createdLinks, executeCalls } = createFixture();

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedCategoricalShiftRecommendation,
  );

  assert.equal(link.shape, "paired_categorical_shift");
  assert.equal(createdLinks.length, 1);
  assert.equal(
    executeCalls
      .flat()
      .some((request) => request.toolName === "paired_category_shift"),
    true,
  );
  if (link.shape === "paired_categorical_shift") {
    assert.equal(link.matchKey, "teilnehmer_id");
    assert.equal(link.pairLabelColumnName, "status_vorher");
    assert.deepEqual(link.matchDiagnostics, {
      matchedCount: 2,
      baselineCount: 2,
      comparisonCount: 2,
      matchedRatio: 1,
      candidateKeysConsidered: ["teilnehmer_id"],
      compatibilityCheck: {
        strategy: "observed_value_domain",
        beforeEpistemicRole: "categorical",
        afterEpistemicRole: "categorical",
        beforeNormalizedValues: ["ja", "nein"],
        afterNormalizedValues: ["ja", "nein"],
      },
    });
  }
});

test("approves a paired_categorical_shift between approved subjective_code columns only when the endline review reuses the baseline codebook provenance", async () => {
  const { service, createdLinks } = createFixture({
    qualitativeCodingReviews: [
      {
        uploadMetadataId: "upload-1",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              tableName: "wirkungsmessung",
              textColumnName: "feedback_vorher",
              syntheticCodeColumnName: "feedback_vorher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "mut" },
                { rowIndex: 1, assignedCode: "orientierung" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-2",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              tableName: "wirkungsmessung_zweite_tabelle",
              textColumnName: "feedback_nachher",
              syntheticCodeColumnName: "feedback_nachher_coded",
              sourceCodebookFrom: {
                uploadMetadataId: "upload-1",
                findingKey: "wirkungsmessung::feedback_vorher",
              },
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "zweifel" },
                { rowIndex: 1, assignedCode: "ziele" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
    ],
  });

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedSubjectiveCodeShiftRecommendation,
  );

  assert.equal(link.shape, "paired_categorical_shift");
  assert.equal(createdLinks.length, 1);
  if (link.shape === "paired_categorical_shift") {
    assert.ok(link.matchDiagnostics);
    assert.deepEqual(link.matchDiagnostics.compatibilityCheck, {
      strategy: "shared_codebook_provenance",
      beforeEpistemicRole: "subjective_code",
      afterEpistemicRole: "subjective_code",
      beforeSourceCodebookUploadMetadataId: null,
      beforeSourceCodebookFindingKey: null,
      afterSourceCodebookUploadMetadataId: "upload-1",
      afterSourceCodebookFindingKey: "wirkungsmessung::feedback_vorher",
    });
  }
});

test("approves a paired_categorical_shift when the baseline review is the one declaring reuse of the endline codebook", async () => {
  // Review order doesn't always match wave chronology — a baseline upload
  // reviewed after its endline counterpart already exists can legitimately
  // produce this reverse pointer. Either direction proves the two findings
  // share one codebook, which is what this check actually guards.
  const { service, createdLinks } = createFixture({
    qualitativeCodingReviews: [
      {
        uploadMetadataId: "upload-1",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              tableName: "wirkungsmessung",
              textColumnName: "feedback_vorher",
              syntheticCodeColumnName: "feedback_vorher_coded",
              sourceCodebookFrom: {
                uploadMetadataId: "upload-2",
                findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              },
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "zweifel" },
                { rowIndex: 1, assignedCode: "ziele" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-2",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              tableName: "wirkungsmessung_zweite_tabelle",
              textColumnName: "feedback_nachher",
              syntheticCodeColumnName: "feedback_nachher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "mut" },
                { rowIndex: 1, assignedCode: "orientierung" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
    ],
  });

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedSubjectiveCodeShiftRecommendation,
  );

  assert.equal(link.shape, "paired_categorical_shift");
  assert.equal(createdLinks.length, 1);
  if (link.shape === "paired_categorical_shift") {
    assert.ok(link.matchDiagnostics);
    assert.deepEqual(link.matchDiagnostics.compatibilityCheck, {
      strategy: "shared_codebook_provenance",
      beforeEpistemicRole: "subjective_code",
      afterEpistemicRole: "subjective_code",
      beforeSourceCodebookUploadMetadataId: "upload-2",
      beforeSourceCodebookFindingKey:
        "wirkungsmessung_zweite_tabelle::feedback_nachher",
      afterSourceCodebookUploadMetadataId: null,
      afterSourceCodebookFindingKey: null,
    });
  }
});

test("rejects a paired_categorical_shift between subjective_code columns when the endline review does not declare baseline codebook reuse", async () => {
  const { service, createdLinks } = createFixture({
    qualitativeCodingReviews: [
      {
        uploadMetadataId: "upload-1",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              tableName: "wirkungsmessung",
              textColumnName: "feedback_vorher",
              syntheticCodeColumnName: "feedback_vorher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "mut" },
                { rowIndex: 1, assignedCode: "orientierung" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-2",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              tableName: "wirkungsmessung_zweite_tabelle",
              textColumnName: "feedback_nachher",
              syntheticCodeColumnName: "feedback_nachher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "zweifel" },
                { rowIndex: 1, assignedCode: "ziele" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
    ],
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedSubjectiveCodeShiftRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code ===
        "outcome_evidence_recommendation_subjective_code_provenance_required",
  );
  assert.equal(createdLinks.length, 0);
});

test("rejects a paired_categorical_shift between subjective_code columns with heavily overlapping code sets but no declared provenance", async () => {
  // Regression test for the "code-set overlap is the wrong proxy" fix:
  // even when the before/after findings happen to share the exact same
  // proposed codes (which a naive implementation might mistake for the
  // same codebook), approval must still be gated on the explicit
  // sourceCodebookFrom pointer, not on how similar the two code sets look.
  const { service, createdLinks } = createFixture({
    qualitativeCodingReviews: [
      {
        uploadMetadataId: "upload-1",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              tableName: "wirkungsmessung",
              textColumnName: "feedback_vorher",
              syntheticCodeColumnName: "feedback_vorher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "mut" },
                { rowIndex: 1, assignedCode: "orientierung" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung::feedback_vorher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
      {
        uploadMetadataId: "upload-2",
        status: "approved",
        findings: {
          summary: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              tableName: "wirkungsmessung_zweite_tabelle",
              textColumnName: "feedback_nachher",
              syntheticCodeColumnName: "feedback_nachher_coded",
              sourceCodebookFrom: null,
              proposedAssignments: [
                { rowIndex: 0, assignedCode: "mut" },
                { rowIndex: 1, assignedCode: "orientierung" },
              ],
            },
          ],
        },
        decisions: {
          columnDecisions: [
            {
              findingKey: "wirkungsmessung_zweite_tabelle::feedback_nachher",
              decision: "approve_as_proposed",
            },
          ],
        },
      },
    ],
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedSubjectiveCodeShiftRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code ===
        "outcome_evidence_recommendation_subjective_code_provenance_required",
  );
  assert.equal(createdLinks.length, 0);
});

test("rejects when outcomeId is missing", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation("user-1", "project-1", "activity-merged", {
        ...singleDistributionRecommendation,
        outcomeId: null,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "outcome_evidence_recommendation_outcome_id_required",
  );
});

test("rejects when the outcome statement does not belong to this project", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation("user-1", "project-1", "activity-merged", {
        ...singleDistributionRecommendation,
        outcomeId: "outcome-does-not-exist",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "project_outcome_statement_not_found",
  );
});

test("rejects when the activity does not belong to this project", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-does-not-exist",
        singleDistributionRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "activity_not_found",
  );
});

test("rejects when the recommendation references a table that no longer exists", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation("user-1", "project-1", "activity-merged", {
        ...singleDistributionRecommendation,
        column: {
          ...singleDistributionRecommendation.column,
          tableName: "table-does-not-exist",
        },
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "outcome_evidence_recommendation_table_not_found",
  );
});

test("rejects when the recommendation references a column that no longer exists on the table", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation("user-1", "project-1", "activity-merged", {
        ...singleDistributionRecommendation,
        column: {
          ...singleDistributionRecommendation.column,
          columnName: "column-does-not-exist",
        },
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "outcome_evidence_recommendation_column_not_found",
  );
});

test("hard-blocks (409) a paired_delta approval whose two columns declare different cohort tags, even if the recommendation somehow got this far", async () => {
  const { service } = createFixture({
    cohortTagBefore: "Jugendliche",
    cohortTagAfter: "Mentor:innen",
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedDeltaRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_cross_cohort_pairing_blocked",
  );
});

test("rejects a paired_delta approval whose before and after reference the same column — the LLM path's own grounding never runs for a manually submitted pairing", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.approveRecommendation("user-1", "project-1", "activity-merged", {
        ...pairedDeltaRecommendation,
        after: pairedDeltaRecommendation.before,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "outcome_evidence_recommendation_before_after_identical",
  );
});

test("rejects a duplicate approval of an already-confirmed pairing", async () => {
  const { service } = createFixture();

  await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    singleDistributionRecommendation,
  );

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        singleDistributionRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_link_already_confirmed",
  );
});

test("removeAllConfirmedLinksForActivity clears every confirmed link for the activity and reports the count", async () => {
  const { service, createdLinks } = createFixture();

  await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedDeltaRecommendation,
  );
  await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    singleDistributionRecommendation,
  );
  assert.equal(createdLinks.length, 2);

  const removedCount = await service.removeAllConfirmedLinksForActivity(
    "user-1",
    "project-1",
    "activity-merged",
  );

  assert.equal(removedCount, 2);
  assert.equal(createdLinks.length, 0);
});

test("removeAllConfirmedLinksForActivity rejects when the activity does not belong to this project", async () => {
  const { service } = createFixture();

  await assert.rejects(
    () =>
      service.removeAllConfirmedLinksForActivity(
        "user-1",
        "project-1",
        "activity-does-not-exist",
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "activity_not_found",
  );
});

test("wraps a tool-executor resolution failure as a clean 502 error rather than a raw thrown exception", async () => {
  const { service } = createFixture({
    executeImpl: () => {
      throw new Error("evidence table missing from storage");
    },
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedDeltaRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 502 &&
      error.code === "outcome_evidence_recommendation_resolution_failed",
  );
});

test("rejects a paired_delta approval whose join produces zero matched pairs, even though both tables declare the same identifier column name", async () => {
  const { service, createdLinks } = createFixture({
    beforeRows: [
      { antwort_id: "antwort-1", teilnehmer_id: "teilnehmer-1", q3_vorher: 2 },
      { antwort_id: "antwort-2", teilnehmer_id: "teilnehmer-2", q3_vorher: 4 },
    ],
    afterRows: [
      { antwort_id: "antwort-3", teilnehmer_id: "teilnehmer-3", q3_nachher: 3 },
      { antwort_id: "antwort-4", teilnehmer_id: "teilnehmer-4", q3_nachher: 5 },
    ],
    executeImpl: (requests) =>
      requests.map((request) => ({
        ...defaultCalculation(requests, request),
        result:
          request.toolName === "paired_change"
            ? { pairedCount: 0, meanPre: 0, meanPost: 0 }
            : defaultCalculation(requests, request).result,
      })),
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedDeltaRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_recommendation_no_matched_pairs",
  );
  assert.equal(createdLinks.length, 0);
});

test("prefers the shared key that yields real matched respondents instead of the tables' heuristic identifierColumn", async () => {
  const { service } = createFixture({
    beforeIdentifierColumn: "antwort_id",
    afterIdentifierColumn: "antwort_id",
  });

  const link = await service.approveRecommendation(
    "user-1",
    "project-1",
    "activity-merged",
    pairedDeltaRecommendation,
  );

  assert.equal(link.shape, "paired_delta");
  if (link.shape === "paired_delta") {
    assert.equal(link.matchKey, "teilnehmer_id");
  }
});

test("rejects a paired_delta approval when multiple shared join keys are equally plausible", async () => {
  const { service, createdLinks } = createFixture({
    afterRows: [
      {
        antwort_id: "antwort-1",
        teilnehmer_id: "teilnehmer-1",
        q3_nachher: 3,
      },
      {
        antwort_id: "antwort-2",
        teilnehmer_id: "teilnehmer-2",
        q3_nachher: 5,
      },
    ],
    executeImpl: (requests) =>
      requests.map((request) => {
        if (request.toolName !== "paired_change") {
          return defaultCalculation(requests, request);
        }
        return {
          ...defaultCalculation(requests, request),
          result: { pairedCount: 2, meanPre: 2, meanPost: 3 },
        };
      }),
  });

  await assert.rejects(
    () =>
      service.approveRecommendation(
        "user-1",
        "project-1",
        "activity-merged",
        pairedDeltaRecommendation,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_recommendation_ambiguous_match_key",
  );
  assert.equal(createdLinks.length, 0);
});
