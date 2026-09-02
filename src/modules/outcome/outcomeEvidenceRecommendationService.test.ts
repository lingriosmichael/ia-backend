import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type {
  OutcomeEvidencePairingRecommendationRequest,
  OutcomeEvidencePairingRecommendationResponse,
  PythonProcessingClient,
} from "../processing/pythonProcessingClient.js";
import type { OutcomeEvidenceCandidateCatalogDependencies } from "./outcomeEvidenceCandidateCatalogBuilder.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "./outcomeEvidenceLinkPersistence.js";
import { OutcomeEvidenceRecommendationService } from "./outcomeEvidenceRecommendationService.js";

const NOW = new Date("2026-08-27T10:00:00.000Z");

const noopLogger = {
  error: () => {},
} as unknown as FastifyBaseLogger;

const outcomeStatement: ProjectOutcomeStatementPersistenceRecord = {
  id: "outcome-1",
  projectId: "project-1",
  organizationId: "org-1",
  term: "short",
  statement: "Jugendliche kennen ihre naechsten Schritte.",
  createdAt: NOW,
  updatedAt: NOW,
};

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

// Two uploads on one merged activity — a baseline file and a follow-up
// file, each contributing one table under the same table name (a plausible
// real shape: both exports use a sheet called "wirkungsmessung"). The
// baseline file also carries the single_distribution candidate
// (besuchsgrund). Deliberately NOT one file with "_vorher"/"_nachher"
// column-name suffixes: that would let a name-pattern coincidence pass the
// datasetRole check even if the direction logic were broken, defeating the
// point of this fixture (see OUTCOME_EVIDENCE_MERGE_PLAN.md's pre/post
// inversion fix) — the before/after pair here is only resolvable via
// datasetRole, never via column labels.
function buildCandidateCatalogDependencies(): OutcomeEvidenceCandidateCatalogDependencies {
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
            identifierColumn: "teilnehmer_id",
            cohortTag: null,
            columns: [
              column("teilnehmer_id", "identifier"),
              column("q3_selbstbild_vorher", "validated_scale"),
              column("besuchsgrund", "categorical"),
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
            name: "wirkungsmessung",
            identifierColumn: "teilnehmer_id",
            cohortTag: null,
            columns: [
              column("teilnehmer_id", "identifier"),
              column("q3_selbstbild_nachher", "validated_scale"),
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
            rows: [
              {
                teilnehmer_id: "t1",
                q3_selbstbild_vorher: "3",
                besuchsgrund: "a",
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
            name: "wirkungsmessung",
            rows: [{ teilnehmer_id: "t1", q3_selbstbild_nachher: "4" }],
          },
        ],
      },
    },
  ];

  return {
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
      findByUploadMetadataIds: async () => [],
    },
  } as unknown as OutcomeEvidenceCandidateCatalogDependencies;
}

// buildOutcomeEvidenceCandidateCatalog assigns a short "col_N" token by
// catalog position, not by the column's own name — upload-1's table
// (identifier column excluded) contributes col_1/col_2 in listed order,
// then upload-2's table contributes col_3, so the mapping below is stable
// for as long as buildCandidateCatalogDependencies' table layout doesn't
// change.
const COLUMN_IDS_BY_NAME: Record<string, string> = {
  q3_selbstbild_vorher: "col_1",
  besuchsgrund: "col_2",
  q3_selbstbild_nachher: "col_3",
};

function buildColumnId(columnName: string): string {
  const columnId = COLUMN_IDS_BY_NAME[columnName];
  if (!columnId) {
    throw new Error(`No known columnId fixture for column "${columnName}".`);
  }
  return columnId;
}

function createFixture(
  recommend: (
    input: OutcomeEvidencePairingRecommendationRequest,
  ) => Promise<OutcomeEvidencePairingRecommendationResponse>,
  confirmedLinks: OutcomeEvidenceLinkPersistenceRecord[] = [],
) {
  let callCount = 0;
  const pythonProcessingClient = {
    async recommendOutcomeEvidencePairings(
      input: OutcomeEvidencePairingRecommendationRequest,
    ) {
      callCount += 1;
      return recommend(input);
    },
  } as unknown as PythonProcessingClient;

  const authorizationService = {
    async canEditProject(_userId: string, projectId: string) {
      return { project: { id: projectId, organizationId: "org-1" } };
    },
    async canViewProject(_userId: string, projectId: string) {
      return { project: { id: projectId, organizationId: "org-1" } };
    },
  } as unknown as AuthorizationService;

  const activityRepository = {
    async findById(activityId: string) {
      return activityId === "activity-merged"
        ? { id: "activity-merged", projectId: "project-1" }
        : null;
    },
  } as unknown as ActivityRepository;

  const projectOutcomeStatementRepository = {
    async listByProjectId() {
      return [outcomeStatement];
    },
  } as unknown as ProjectOutcomeStatementRepository;

  const outcomeEvidenceLinkRepository = {
    async listByActivityId() {
      return confirmedLinks;
    },
  } as unknown as OutcomeEvidenceLinkRepository;

  const service = new OutcomeEvidenceRecommendationService(
    authorizationService,
    activityRepository,
    projectOutcomeStatementRepository,
    buildCandidateCatalogDependencies(),
    pythonProcessingClient,
    noopLogger,
    outcomeEvidenceLinkRepository,
  );

  return { service, getCallCount: () => callCount };
}

test("resolves a well-formed paired_delta recommendation back to real column references", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "paired_delta",
        beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
        afterColumnId: buildColumnId("q3_selbstbild_nachher"),
        outcomeId: outcomeStatement.id,
        rationale: "Same self-efficacy scale, asked twice.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, [
    {
      shape: "paired_delta",
      before: {
        uploadMetadataId: "upload-1",
        tableName: "wirkungsmessung",
        columnName: "q3_selbstbild_vorher",
        label: "Q3 selbstbild vorher",
        cohortTag: null,
        datasetRole: "baseline",
      },
      after: {
        uploadMetadataId: "upload-2",
        tableName: "wirkungsmessung",
        columnName: "q3_selbstbild_nachher",
        label: "Q3 selbstbild nachher",
        cohortTag: null,
        datasetRole: "followup",
      },
      outcomeId: outcomeStatement.id,
      rationale: "Same self-efficacy scale, asked twice.",
    },
  ]);
});

test("direction comes from datasetRole, never from which field the LLM populated", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "paired_delta",
        // Deliberately swapped: the follow-up column's id is in
        // beforeColumnId and the baseline column's id is in afterColumnId.
        // resolveRecommendation must still resolve `before` to the
        // baseline-role column and `after` to the follow-up-role column,
        // ignoring this placement entirely — see
        // OUTCOME_EVIDENCE_MERGE_PLAN.md's pre/post inversion fix.
        beforeColumnId: buildColumnId("q3_selbstbild_nachher"),
        afterColumnId: buildColumnId("q3_selbstbild_vorher"),
        outcomeId: outcomeStatement.id,
        rationale: "Same self-efficacy scale, asked twice.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.equal(result.length, 1);
  const [recommendation] = result;
  assert.equal(recommendation?.shape, "paired_delta");
  if (recommendation?.shape !== "paired_delta") {
    throw new Error("expected a paired_delta recommendation");
  }
  assert.equal(recommendation.before.columnName, "q3_selbstbild_vorher");
  assert.equal(recommendation.before.uploadMetadataId, "upload-1");
  assert.equal(recommendation.after.columnName, "q3_selbstbild_nachher");
  assert.equal(recommendation.after.uploadMetadataId, "upload-2");
});

test("a paired_delta recommendation whose two columns share the same datasetRole is dropped", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "paired_delta",
        beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
        afterColumnId: buildColumnId("besuchsgrund"),
        outcomeId: null,
        rationale: "...",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("resolves a well-formed single_distribution recommendation with a null outcomeId", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "single_distribution",
        columnId: buildColumnId("besuchsgrund"),
        outcomeId: null,
        rationale: "Category breakdown with no matching outcome.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, [
    {
      shape: "single_distribution",
      column: {
        uploadMetadataId: "upload-1",
        tableName: "wirkungsmessung",
        columnName: "besuchsgrund",
        label: "Besuchsgrund",
        cohortTag: null,
        datasetRole: "baseline",
      },
      outcomeId: null,
      rationale: "Category breakdown with no matching outcome.",
    },
  ]);
});

test("resolves a well-formed paired_categorical_shift recommendation back to real column references", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "paired_categorical_shift",
        beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
        afterColumnId: buildColumnId("q3_selbstbild_nachher"),
        outcomeId: outcomeStatement.id,
        rationale: "Same fixed-response question, asked before and after.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, [
    {
      shape: "paired_categorical_shift",
      before: {
        uploadMetadataId: "upload-1",
        tableName: "wirkungsmessung",
        columnName: "q3_selbstbild_vorher",
        label: "Q3 selbstbild vorher",
        cohortTag: null,
        datasetRole: "baseline",
      },
      after: {
        uploadMetadataId: "upload-2",
        tableName: "wirkungsmessung",
        columnName: "q3_selbstbild_nachher",
        label: "Q3 selbstbild nachher",
        cohortTag: null,
        datasetRole: "followup",
      },
      outcomeId: outcomeStatement.id,
      rationale: "Same fixed-response question, asked before and after.",
    },
  ]);
});

test("a hallucinated outcomeId is never trusted, even though Python's own grounding should already have caught it", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "single_distribution",
        columnId: buildColumnId("besuchsgrund"),
        outcomeId: "outcome-does-not-belong-to-this-project",
        rationale: "Looks related.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const [result] = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.equal(result?.outcomeId, null);
});

test("a hallucinated columnId is dropped, not passed through as a broken reference", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "single_distribution",
        columnId: "column-does-not-exist",
        outcomeId: null,
        rationale: "...",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("a paired_delta recommendation pairing a column with itself is dropped", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "paired_delta",
        beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
        afterColumnId: buildColumnId("q3_selbstbild_vorher"),
        outcomeId: null,
        rationale: "...",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("a recommendation matching an already-confirmed link's column(s) is dropped", async () => {
  const alreadyConfirmedLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: outcomeStatement.id,
    shape: "single_distribution",
    activityId: "activity-merged",
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    categoryColumnName: "besuchsgrund",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const { service } = createFixture(
    async () => ({
      recommendations: [
        {
          shape: "single_distribution",
          columnId: buildColumnId("besuchsgrund"),
          outcomeId: outcomeStatement.id,
          rationale: "Category breakdown.",
        },
      ],
      groundingStatus: "PASSED",
    }),
    [alreadyConfirmedLink],
  );

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("a recommendation matching an already-confirmed paired_categorical_shift link's columns is dropped", async () => {
  // Regression test for the §5 rollout fix: "Get recommendations" now stays
  // available even with existing confirmed links, which only stays safe if
  // dedup also covers the new shape, not just single_distribution/paired_delta.
  const alreadyConfirmedLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: outcomeStatement.id,
    shape: "paired_categorical_shift",
    activityIdBefore: "activity-merged",
    activityIdAfter: "activity-merged",
    beforeUploadMetadataId: "upload-1",
    beforeTableName: "wirkungsmessung",
    beforeColumnName: "q3_selbstbild_vorher",
    afterUploadMetadataId: "upload-2",
    afterTableName: "wirkungsmessung",
    afterColumnName: "q3_selbstbild_nachher",
    matchKey: "teilnehmer_id",
    pairLabelColumnName: "q3_selbstbild_vorher",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const { service } = createFixture(
    async () => ({
      recommendations: [
        {
          shape: "paired_categorical_shift",
          beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
          afterColumnId: buildColumnId("q3_selbstbild_nachher"),
          outcomeId: outcomeStatement.id,
          rationale: "Same fixed-response question, asked before and after.",
        },
      ],
      groundingStatus: "PASSED",
    }),
    [alreadyConfirmedLink],
  );

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("rollout: a project with an existing confirmed link still gets new, non-overlapping recommendations proposed", async () => {
  // Regression coverage for the §5 rollout guarantee itself, not just the
  // dedup mechanics: "Get recommendations" stays useful (not just safe) on
  // a project that already has confirmed links — matching recommendations
  // are dropped, but a genuinely new one for different columns still
  // comes through undisturbed.
  const alreadyConfirmedLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: outcomeStatement.id,
    shape: "single_distribution",
    activityId: "activity-merged",
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    categoryColumnName: "besuchsgrund",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const { service } = createFixture(
    async () => ({
      recommendations: [
        {
          shape: "single_distribution",
          columnId: buildColumnId("besuchsgrund"),
          outcomeId: outcomeStatement.id,
          rationale: "Category breakdown.",
        },
        {
          shape: "paired_categorical_shift",
          beforeColumnId: buildColumnId("q3_selbstbild_vorher"),
          afterColumnId: buildColumnId("q3_selbstbild_nachher"),
          outcomeId: outcomeStatement.id,
          rationale: "Same fixed-response question, asked before and after.",
        },
      ],
      groundingStatus: "PASSED",
    }),
    [alreadyConfirmedLink],
  );

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.shape, "paired_categorical_shift");
});

test("groundingStatus FAILED results in an empty list, not a padded ungrounded result", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [],
    groundingStatus: "FAILED",
  }));

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("a thrown error from the Python client is caught and results in an empty list", async () => {
  const { service } = createFixture(async () => {
    throw new Error("python processing service unavailable");
  });

  const result = await service.recommendForActivity(
    "project-1",
    "activity-merged",
    [outcomeStatement],
  );

  assert.deepEqual(result, []);
});

test("never calls the Python client when the activity has no eligible candidates", async () => {
  const { service, getCallCount } = createFixture(async () => ({
    recommendations: [],
    groundingStatus: "PASSED",
  }));

  await service.recommendForActivity("project-1", "activity-with-no-uploads", [
    outcomeStatement,
  ]);

  assert.equal(getCallCount(), 0);
});

test("recommendForProject authorizes, scopes the activity to the project, fetches outcome statements, and delegates", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [
      {
        shape: "single_distribution",
        columnId: buildColumnId("besuchsgrund"),
        outcomeId: outcomeStatement.id,
        rationale: "...",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.recommendForProject(
    "user-1",
    "project-1",
    "activity-merged",
  );

  assert.equal(result.length, 1);
});

test("listCandidatesForActivity exposes the same catalog the recommend call builds, with no LLM call involved", async () => {
  const { service, getCallCount } = createFixture(async () => ({
    recommendations: [],
    groundingStatus: "PASSED",
  }));

  const candidates = await service.listCandidatesForActivity(
    "user-1",
    "project-1",
    "activity-merged",
  );

  assert.deepEqual(candidates.map((candidate) => candidate.columnName).sort(), [
    "besuchsgrund",
    "q3_selbstbild_nachher",
    "q3_selbstbild_vorher",
  ]);
  assert.equal(getCallCount(), 0);
});

test("listConfirmedLinksForActivity humanizes each column's raw name into a display label", async () => {
  const confirmedLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: outcomeStatement.id,
    shape: "single_distribution",
    activityId: "activity-merged",
    uploadMetadataId: "upload-1",
    tableName: "wirkungsmessung",
    categoryColumnName: "besuchsgrund",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const { service } = createFixture(
    async () => ({ recommendations: [], groundingStatus: "PASSED" }),
    [confirmedLink],
  );

  const links = await service.listConfirmedLinksForActivity(
    "user-1",
    "project-1",
    "activity-merged",
  );

  assert.deepEqual(links, [
    {
      linkId: "link-1",
      shape: "single_distribution",
      outcomeId: outcomeStatement.id,
      confirmedAt: NOW.toISOString(),
      column: {
        uploadMetadataId: "upload-1",
        tableName: "wirkungsmessung",
        columnName: "besuchsgrund",
        label: "Besuchsgrund",
        cohortTag: null,
        datasetRole: null,
      },
    },
  ]);
});

test("recommendForProject rejects when the activity does not belong to this project", async () => {
  const { service } = createFixture(async () => ({
    recommendations: [],
    groundingStatus: "PASSED",
  }));

  await assert.rejects(
    () =>
      service.recommendForProject(
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
