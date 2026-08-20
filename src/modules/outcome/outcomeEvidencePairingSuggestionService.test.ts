import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { OutcomeEvidencePairingProposalPairedDelta } from "../../shared/contracts.js";
import type {
  OutcomeEvidencePairingSuggestionRequest,
  OutcomeEvidencePairingSuggestionResponse,
  PythonProcessingClient,
} from "../processing/pythonProcessingClient.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import { OutcomeEvidencePairingSuggestionService } from "./outcomeEvidencePairingSuggestionService.js";

const NOW = new Date("2026-08-20T10:00:00.000Z");

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

const candidate: OutcomeEvidencePairingProposalPairedDelta = {
  proposalId: "candidate-1",
  shape: "paired_delta",
  activityIdBefore: "activity-baseline",
  activityIdAfter: "activity-impact-measurement",
  beforeUploadMetadataId: "upload-baseline",
  beforeTableName: "umfrage",
  beforeColumnName: "selbstwirksamkeit_1_5",
  afterUploadMetadataId: "upload-wirkungsmessung",
  afterTableName: "umfrage",
  afterColumnName: "selbstwirksamkeit_1_5",
  matchKey: "teilnehmer_id",
  pairingGroupKey: "Selbstwirksamkeit",
  suggestedOutcome: null,
};

function createFixture(
  suggest: (
    input: OutcomeEvidencePairingSuggestionRequest,
  ) => Promise<OutcomeEvidencePairingSuggestionResponse>,
) {
  let callCount = 0;
  const pythonProcessingClient = {
    async suggestOutcomeEvidencePairingOutcomes(
      input: OutcomeEvidencePairingSuggestionRequest,
    ) {
      callCount += 1;
      return suggest(input);
    },
  } as unknown as PythonProcessingClient;

  const service = new OutcomeEvidencePairingSuggestionService(
    pythonProcessingClient,
    noopLogger,
  );

  return { service, getCallCount: () => callCount };
}

test("maps a well-formed suggestion response back onto the candidate's proposalId", async () => {
  const { service } = createFixture(async () => ({
    suggestions: [
      {
        candidateId: "candidate-1",
        outcomeId: outcomeStatement.id,
        rationale: "Measures self-efficacy before/after.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [outcomeStatement],
    candidates: [candidate],
    activityNameById: new Map([
      ["activity-baseline", "Baseline"],
      ["activity-impact-measurement", "Wirkungsmessung"],
    ]),
  });

  assert.deepEqual(result.get("candidate-1"), {
    outcomeId: outcomeStatement.id,
    rationale: "Measures self-efficacy before/after.",
  });
});

test("a hallucinated outcomeId (not one of the project's declared outcome statements) is never trusted", async () => {
  const { service } = createFixture(async () => ({
    suggestions: [
      {
        candidateId: "candidate-1",
        outcomeId: "outcome-does-not-belong-to-this-project",
        rationale: "Looks related.",
      },
    ],
    groundingStatus: "PASSED",
  }));

  const result = await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [outcomeStatement],
    candidates: [candidate],
    activityNameById: new Map(),
  });

  const suggestion = result.get("candidate-1");
  assert.ok(suggestion);
  assert.equal(suggestion.outcomeId, null);
});

test("groundingStatus FAILED results in an empty map, not a padded uncertain answer", async () => {
  const { service } = createFixture(async () => ({
    suggestions: [],
    groundingStatus: "FAILED",
  }));

  const result = await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [outcomeStatement],
    candidates: [candidate],
    activityNameById: new Map(),
  });

  assert.equal(result.size, 0);
});

test("a thrown error from the Python client is caught and results in an empty map", async () => {
  const { service } = createFixture(async () => {
    throw new Error("python processing service unavailable");
  });

  const result = await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [outcomeStatement],
    candidates: [candidate],
    activityNameById: new Map(),
  });

  assert.equal(result.size, 0);
});

test("never calls the Python client when there are no candidates or no outcome statements", async () => {
  const { service, getCallCount } = createFixture(async () => ({
    suggestions: [],
    groundingStatus: "PASSED",
  }));

  await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [],
    candidates: [candidate],
    activityNameById: new Map(),
  });
  await service.suggestOutcomes({
    projectId: "project-1",
    language: "de",
    outcomeStatements: [outcomeStatement],
    candidates: [],
    activityNameById: new Map(),
  });

  assert.equal(getCallCount(), 0);
});
