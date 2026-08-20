import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationService } from "../interpretation/interpretationService.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { OutcomeEvidencePairingSuggestedOutcome } from "../../shared/contracts.js";
import {
  OutcomeEvidencePairingService,
  listDiagnosticReasons,
} from "./outcomeEvidencePairingService.js";
import type { OutcomeEvidencePairingEvidenceTable } from "./outcomeEvidencePairingEvidenceLoader.js";
import type { OutcomeEvidencePairingResultRepository } from "./outcomeEvidencePairingResultRepository.js";
import type { OutcomeEvidencePairingResultPersistenceRecord } from "./outcomeEvidencePairingResultPersistence.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "./outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import type {
  OutcomeEvidencePairingSuggestionInput,
  OutcomeEvidencePairingSuggestionService,
} from "./outcomeEvidencePairingSuggestionService.js";

const NOW = new Date("2026-08-18T10:00:00.000Z");

interface CreateFixtureOptions {
  outcomeStatements?: ProjectOutcomeStatementPersistenceRecord[];
  suggestOutcomesImpl?: (
    input: OutcomeEvidencePairingSuggestionInput,
  ) => Promise<Map<string, OutcomeEvidencePairingSuggestedOutcome>>;
  inspectActivityInterpretationReadinessImpl?: () => Promise<{
    uploadCount: number;
    activeUploadCount: number;
    eligibleUploadCount: number;
    uploadStates: Array<{
      uploadMetadataId: string;
      originalFileName: string;
      reason:
        | "active_job"
        | "already_interpreted"
        | "ready_to_interpret"
        | "privacy_safe_representation_missing"
        | "unsupported_modality";
      latestJobStatus: string | null;
      latestJobType: string | null;
      evidenceModality: string | null;
    }>;
  }>;
}

function createFixture(options: CreateFixtureOptions = {}) {
  const activityRepository = {
    listByProject: async () => [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Wirkungsmessung",
        systemType: "impact_measurement",
      },
    ],
  } as unknown as ActivityRepository;

  const uploadMetadataRepository = {
    listByActivityIds: async () => [
      {
        id: "upload-1",
        activityId: "activity-1",
        originalFileName: "wirkungsmessung.csv",
      },
    ],
  } as unknown as UploadMetadataRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        id: "result-1",
        organizationId: "org-1",
        projectId: "project-1",
        uploadMetadataId: "upload-1",
      },
    ],
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async () => [
      {
        interpretationResultId: "result-1",
        status: "analysis_completed",
        preparedDataset: {
          isReadyForDeterministicAnalysis: true,
          tables: [
            {
              name: "wirkungsmessung_abschluss",
              identifierColumn: "teilnehmer_id",
              columns: [
                {
                  name: "teilnehmer_id",
                  inferredType: "identifier",
                  role: "identifier",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: null,
                  epistemicRole: "identifier",
                },
                {
                  name: "naechster_schritt_art",
                  inferredType: "categorical",
                  role: "measure",
                  positiveStatusValues: [],
                  positiveStatusDefinitionText: null,
                  normalizationAccepted: null,
                  epistemicRole: "categorical",
                },
              ],
            },
          ],
        },
      },
    ],
  } as unknown as DatasetPreparationRepository;

  let pairingResult: OutcomeEvidencePairingResultPersistenceRecord | null =
    null;
  const outcomeEvidencePairingResultRepository: OutcomeEvidencePairingResultRepository =
    {
      async upsertByProjectId(input) {
        pairingResult = {
          id: pairingResult?.id ?? "pairing-result-1",
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: input.status,
          proposals: input.proposals,
          proposalDecisions: input.proposalDecisions,
          createdAt: pairingResult?.createdAt ?? NOW,
          updatedAt: NOW,
        };
        return pairingResult;
      },
      async findByProjectId() {
        return pairingResult;
      },
      async deleteByProjectId() {
        pairingResult = null;
        return 1;
      },
      async upsertProposalDecision(_projectId, decision) {
        if (!pairingResult) {
          return null;
        }
        pairingResult = {
          ...pairingResult,
          proposalDecisions: [...pairingResult.proposalDecisions, decision],
        };
        return pairingResult;
      },
    };

  const createdLinks: OutcomeEvidenceLinkPersistenceRecord[] = [];
  const outcomeEvidenceLinkRepository: OutcomeEvidenceLinkRepository = {
    async create(input) {
      const record = {
        ...input,
        linkId: `link-${createdLinks.length + 1}`,
        createdAt: NOW,
        updatedAt: NOW,
      } as OutcomeEvidenceLinkPersistenceRecord;
      createdLinks.push(record);
      return record;
    },
    async findById(linkId: string) {
      return createdLinks.find((link) => link.linkId === linkId) ?? null;
    },
    async listByProjectId() {
      return createdLinks;
    },
    async deleteByProjectId() {
      const deletedCount = createdLinks.length;
      createdLinks.splice(0, createdLinks.length);
      return deletedCount;
    },
    async deleteByActivityId() {
      return 0;
    },
    async deleteByUploadMetadataId() {
      return 0;
    },
    async deleteById(linkId: string) {
      const index = createdLinks.findIndex((link) => link.linkId === linkId);
      if (index === -1) {
        return false;
      }
      createdLinks.splice(index, 1);
      return true;
    },
  };

  const outcomeStatement: ProjectOutcomeStatementPersistenceRecord = {
    id: "outcome-1",
    projectId: "project-1",
    organizationId: "org-1",
    term: "short",
    statement: "Jugendliche kennen ihre naechsten Schritte.",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const outcomeStatements = options.outcomeStatements ?? [outcomeStatement];
  const projectOutcomeStatementRepository = {
    async findById(outcomeStatementId: string) {
      return outcomeStatementId === outcomeStatement.id
        ? outcomeStatement
        : null;
    },
    async listByProjectId() {
      return outcomeStatements;
    },
  } as unknown as ProjectOutcomeStatementRepository;

  let suggestOutcomesCallCount = 0;
  const suggestOutcomesCalls: OutcomeEvidencePairingSuggestionInput[] = [];
  const suggestOutcomesImpl =
    options.suggestOutcomesImpl ??
    (async () => new Map<string, OutcomeEvidencePairingSuggestedOutcome>());
  const outcomeEvidencePairingSuggestionService = {
    async suggestOutcomes(input: OutcomeEvidencePairingSuggestionInput) {
      suggestOutcomesCallCount += 1;
      suggestOutcomesCalls.push(input);
      return suggestOutcomesImpl(input);
    },
  } as unknown as OutcomeEvidencePairingSuggestionService;

  const authorizationService = {
    canViewProject: async (_userId: string, projectId: string) => ({
      project: { id: projectId, organizationId: "org-1" },
    }),
    canEditProject: async (_userId: string, projectId: string) => ({
      project: { id: projectId, organizationId: "org-1" },
    }),
  } as unknown as AuthorizationService;
  const interpretationService = {
    async inspectActivityInterpretationReadiness() {
      if (options.inspectActivityInterpretationReadinessImpl) {
        return options.inspectActivityInterpretationReadinessImpl();
      }
      return {
        uploadCount: 1,
        activeUploadCount: 0,
        eligibleUploadCount: 0,
        uploadStates: [
          {
            uploadMetadataId: "upload-1",
            originalFileName: "wirkungsmessung.csv",
            reason: "already_interpreted",
            latestJobStatus: "completed",
            latestJobType: "dataset_interpretation",
            evidenceModality: "structured_quantitative",
          },
        ],
      };
    },
  } as unknown as InterpretationService;
  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        uploadMetadataId: "upload-1",
        payload: {
          tables: [
            {
              name: "wirkungsmessung_abschluss",
              rows: [
                { teilnehmer_id: "J001", zielgruppe: "jugendliche" },
                { teilnehmer_id: "J002", zielgruppe: "jugendliche" },
              ],
            },
          ],
        },
      },
    ],
  } as unknown as PrivacySafeRepresentationRepository;

  const service = new OutcomeEvidencePairingService(
    authorizationService,
    activityRepository,
    uploadMetadataRepository,
    interpretationResultRepository,
    datasetPreparationRepository,
    privacySafeRepresentationRepository,
    outcomeEvidencePairingResultRepository,
    outcomeEvidenceLinkRepository,
    projectOutcomeStatementRepository,
    outcomeEvidencePairingSuggestionService,
    interpretationService,
  );

  return {
    service,
    createdLinks,
    outcomeStatement,
    getSuggestOutcomesCallCount: () => suggestOutcomesCallCount,
    suggestOutcomesCalls,
  };
}

test("proposeForProject surfaces the single_distribution candidate for an unlinked categorical column", async () => {
  const { service } = createFixture();

  const result = await service.proposeForProject("user-1", "project-1");

  assert.equal(result.status, "needs_review");
  assert.equal(result.proposals.length, 1);
  assert.equal(result.eligibleEvidenceOptions.length, 1);
  assert.equal(result.proposals[0]?.shape, "single_distribution");
  assert.equal(result.diagnostics.trigger, "propose");
  assert.equal(result.diagnostics.candidateCount, 1);
});

test("assigning a proposal to a declared outcome creates a confirmed OutcomeEvidenceLink and removes it from pending proposals", async () => {
  const { service, createdLinks, outcomeStatement } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const proposalId = proposed.proposals[0]!.proposalId;

  const result = await service.decideProposal(
    "user-1",
    "project-1",
    proposalId,
    "assign",
    outcomeStatement.id,
  );

  assert.equal(result.proposals.length, 0);
  assert.equal(result.status, "resolved");
  assert.equal(createdLinks.length, 1);
  assert.equal(createdLinks[0]?.outcomeId, outcomeStatement.id);
  assert.equal(createdLinks[0]?.shape, "single_distribution");
});

test("removing a confirmed OutcomeEvidenceLink reopens its proposal for review", async () => {
  const { service, createdLinks, outcomeStatement } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const proposalId = proposed.proposals[0]!.proposalId;

  await service.decideProposal(
    "user-1",
    "project-1",
    proposalId,
    "assign",
    outcomeStatement.id,
  );
  assert.equal(createdLinks.length, 1);

  const result = await service.removeConfirmedLink(
    "user-1",
    "project-1",
    createdLinks[0]!.linkId,
  );

  assert.equal(createdLinks.length, 0);
  assert.equal(result.status, "needs_review");
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.proposalId, proposalId);
});

test("assigning without an outcomeId is rejected before touching any repository", async () => {
  const { service, createdLinks } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const proposalId = proposed.proposals[0]!.proposalId;

  await assert.rejects(
    () =>
      service.decideProposal("user-1", "project-1", proposalId, "assign", null),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "outcome_evidence_pairing_outcome_id_required");
      return true;
    },
  );
  assert.equal(createdLinks.length, 0);
});

test("assigning to an outcome statement outside this project is rejected", async () => {
  const { service } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const proposalId = proposed.proposals[0]!.proposalId;

  await assert.rejects(
    () =>
      service.decideProposal(
        "user-1",
        "project-1",
        proposalId,
        "assign",
        "outcome-does-not-exist",
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "project_outcome_statement_not_found");
      return true;
    },
  );
});

test("rejecting a proposal removes it from pending without creating a link", async () => {
  const { service, createdLinks } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const proposalId = proposed.proposals[0]!.proposalId;

  const result = await service.decideProposal(
    "user-1",
    "project-1",
    proposalId,
    "reject",
    null,
  );

  assert.equal(result.proposals.length, 0);
  assert.equal(createdLinks.length, 0);
});

test("proposeForProject attaches a suggested outcome from the suggestion collaborator on first call", async () => {
  const { service, outcomeStatement, getSuggestOutcomesCallCount } =
    createFixture({
      suggestOutcomesImpl: async (input) =>
        new Map(
          input.candidates.map((candidate) => [
            candidate.proposalId,
            { outcomeId: outcomeStatement.id, rationale: "Matches." },
          ]),
        ),
    });

  const result = await service.proposeForProject("user-1", "project-1");

  assert.equal(getSuggestOutcomesCallCount(), 1);
  assert.deepEqual(result.proposals[0]?.suggestedOutcome, {
    outcomeId: outcomeStatement.id,
    rationale: "Matches.",
  });
});

test("proposeForProject does not re-invoke the suggestion collaborator for an already-suggested, still-pending proposal", async () => {
  const { service, outcomeStatement, getSuggestOutcomesCallCount } =
    createFixture({
      suggestOutcomesImpl: async (input) =>
        new Map(
          input.candidates.map((candidate) => [
            candidate.proposalId,
            { outcomeId: outcomeStatement.id, rationale: "Matches." },
          ]),
        ),
    });

  const first = await service.proposeForProject("user-1", "project-1");
  const second = await service.proposeForProject("user-1", "project-1");

  assert.equal(getSuggestOutcomesCallCount(), 1);
  assert.deepEqual(
    second.proposals[0]?.suggestedOutcome,
    first.proposals[0]?.suggestedOutcome,
  );
});

test("proposeForProject never calls the suggestion collaborator when the project has no declared outcome statements", async () => {
  const { service, getSuggestOutcomesCallCount } = createFixture({
    outcomeStatements: [],
  });

  const result = await service.proposeForProject("user-1", "project-1");

  assert.equal(getSuggestOutcomesCallCount(), 0);
  assert.equal(result.proposals[0]?.suggestedOutcome, null);
});

test("proposeForProject still succeeds with suggestedOutcome null when the suggestion collaborator fails", async () => {
  const { service } = createFixture({
    suggestOutcomesImpl: async () => {
      throw new Error("python service unavailable");
    },
  });

  const result = await service.proposeForProject("user-1", "project-1");

  assert.equal(result.status, "needs_review");
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.suggestedOutcome, null);
});

test("deciding an unknown proposalId 404s", async () => {
  const { service } = createFixture();
  await service.proposeForProject("user-1", "project-1");

  await assert.rejects(
    () =>
      service.decideProposal(
        "user-1",
        "project-1",
        "not-a-real-proposal",
        "reject",
        null,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "outcome_evidence_pairing_proposal_not_found");
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test("refreshForProject stays read-only and reports blocked interpretation prerequisites in diagnostics", async () => {
  const { service } = createFixture({
    inspectActivityInterpretationReadinessImpl: async () => ({
      uploadCount: 1,
      activeUploadCount: 0,
      eligibleUploadCount: 1,
      uploadStates: [
        {
          uploadMetadataId: "upload-1",
          originalFileName: "wirkungsmessung.csv",
          reason: "ready_to_interpret",
          latestJobStatus: null,
          latestJobType: null,
          evidenceModality: "structured_quantitative",
        },
      ],
    }),
  });

  const result = await service.refreshForProject("user-1", "project-1");

  assert.equal(result.diagnostics.trigger, "refresh");
  assert.equal(
    result.diagnostics.activityDiagnostics[0]?.status,
    "already_ready",
  );
  assert.equal(
    result.diagnostics.activityDiagnostics[0]?.uploadStates[0]?.reason,
    "ready_to_interpret",
  );
});

test("assigning a previously rejected but still eligible evidence option succeeds through the deterministic picker path", async () => {
  const { service, outcomeStatement, createdLinks } = createFixture();
  const proposed = await service.proposeForProject("user-1", "project-1");
  const optionId = proposed.eligibleEvidenceOptions[0]!.proposalId;

  await service.decideProposal("user-1", "project-1", optionId, "reject", null);

  const result = await service.decideProposal(
    "user-1",
    "project-1",
    optionId,
    "assign",
    outcomeStatement.id,
  );

  assert.equal(createdLinks.length, 1);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.eligibleEvidenceOptions.length, 0);
});

function diagnosticColumn(
  name: string,
  epistemicRole: "validated_scale" | "categorical",
  options?: {
    minValue?: number | null;
    maxValue?: number | null;
    pairingGroupKey?: string | null;
    pairingGroupRole?: "before" | "after" | null;
  },
) {
  return {
    name,
    inferredType: null,
    role: "measure" as const,
    positiveStatusValues: [],
    positiveStatusDefinitionText: null,
    normalizationAccepted: null,
    epistemicRole,
    minValue: options?.minValue ?? null,
    maxValue: options?.maxValue ?? null,
    pairingGroupKey: options?.pairingGroupKey ?? null,
    pairingGroupRole: options?.pairingGroupRole ?? null,
  };
}

test("listDiagnosticReasons reports duplicate_identifier_values when a table's identifier column isn't unique", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [diagnosticColumn("naechster_schritt_art", "categorical")],
      hasDuplicateIdentifierValues: true,
    },
  ];

  const reasons = listDiagnosticReasons("propose", 0, tables, []);
  assert.ok(
    reasons.some((reason) => reason.code === "duplicate_identifier_values"),
  );
});

test("listDiagnosticReasons reports scale_bounds_mismatch when a declared before/after pair disagrees on bounds", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        diagnosticColumn("selbstwirksamkeit_1_5", "validated_scale", {
          minValue: 1,
          maxValue: 5,
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "before",
        }),
      ],
    },
    {
      activityId: "activity-impact-measurement",
      activitySystemType: "impact_measurement",
      uploadMetadataId: "upload-wirkungsmessung",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [
        diagnosticColumn("selbstwirksamkeit_1_5", "validated_scale", {
          minValue: 0,
          maxValue: 10,
          pairingGroupKey: "Selbstwirksamkeit",
          pairingGroupRole: "after",
        }),
      ],
    },
  ];

  const reasons = listDiagnosticReasons("propose", 0, tables, []);
  assert.ok(reasons.some((reason) => reason.code === "scale_bounds_mismatch"));
});

test("listDiagnosticReasons reports no_declared_pairing_groups when validated_scale columns exist but none have a declared pairing group yet", () => {
  const tables: OutcomeEvidencePairingEvidenceTable[] = [
    {
      activityId: "activity-baseline",
      activitySystemType: "baseline",
      uploadMetadataId: "upload-baseline",
      tableName: "umfrage",
      identifierColumn: "teilnehmer_id",
      columns: [diagnosticColumn("selbstwirksamkeit_1_5", "validated_scale")],
    },
  ];

  const reasons = listDiagnosticReasons("propose", 0, tables, []);
  assert.ok(
    reasons.some((reason) => reason.code === "no_declared_pairing_groups"),
  );
  assert.ok(
    !reasons.some((reason) => reason.code === "no_matching_scale_columns"),
  );
});
