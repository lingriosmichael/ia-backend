import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsQueryService } from "./analyticsQueryService.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { AnalyticsResultPersistenceRecord } from "./analyticsResultPersistence.js";
import { CURATOR_MODEL_VERSION } from "./analyticsContracts.js";
import {
  createFakeAuthorization,
  makeKnowledgeModel,
  makeProject,
  NOW,
} from "./analyticsTestFixtures.js";

function makeExecution(
  overrides: Partial<AnalyticsExecutionPersistenceRecord> = {},
): AnalyticsExecutionPersistenceRecord {
  return {
    id: "execution-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: null,
    scopeType: "PROJECT",
    status: "COMPLETED",
    startedAt: NOW,
    completedAt: NOW,
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<AnalyticsResultPersistenceRecord> = {},
): AnalyticsResultPersistenceRecord {
  return {
    id: "result-1",
    analyticsExecutionId: "execution-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: null,
    scopeType: "PROJECT",
    catalogVersion: "3.0",
    knowledgeModelVersion: 1,
    catalog: {
      catalogVersion: "3.0",
      knowledgeModelVersion: 1,
      scope: { type: "PROJECT", projectId: "project-1", activityId: null },
      entries: [],
      omittedEntries: [],
      qualitySignals: [],
    },
    curation: {
      featuredEntryIds: [],
      narrative: [],
      groundingStatus: "PASSED",
      groundingRetryCount: 0,
      curatorModelVersion: CURATOR_MODEL_VERSION,
      fellBackToSelectionOnly: false,
    },
    dataQuality: { recordsExcludedCount: 0, warnings: [] },
    limitations: [],
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createFakeRepos(options: {
  model: ReturnType<typeof makeKnowledgeModel> | null;
  execution: AnalyticsExecutionPersistenceRecord | null;
  result: AnalyticsResultPersistenceRecord | null;
}) {
  let currentExecution = options.execution;

  const projectKnowledgeModelRepository = {
    findByProjectId: async () => options.model,
  } as unknown as ProjectKnowledgeModelRepository;

  const analyticsExecutionRepository = {
    findLatestByScope: async () => currentExecution,
    updateStatus: async (_id: string, update: { status: string }) => {
      if (!currentExecution) {
        return null;
      }
      currentExecution = {
        ...currentExecution,
        status: update.status,
      } as AnalyticsExecutionPersistenceRecord;
      return currentExecution;
    },
    deleteByProjectId: async () => 0,
  } as unknown as AnalyticsExecutionRepository;

  const analyticsResultRepository = {
    findLatestByScope: async () => options.result,
    deleteByProjectId: async () => 0,
  } as unknown as AnalyticsResultRepository;

  return {
    projectKnowledgeModelRepository,
    analyticsExecutionRepository,
    analyticsResultRepository,
    getCurrentExecution: () => currentExecution,
  };
}

test("no execution or result yet returns nulls without touching staleness logic", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({ model: null, execution: null, result: null });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution, null);
  assert.equal(result, null);
});

test("a completed result matching the current model/curator version is not marked stale", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "COMPLETED");
});

test("a Project Knowledge Model version bump marks a completed result STALE", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 2 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(repos.getCurrentExecution()!.status, "STALE");
  assert.equal(result, null);
});

test("a curator model version mismatch also marks a completed result STALE", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({
      knowledgeModelVersion: 1,
      curation: {
        featuredEntryIds: [],
        narrative: [],
        groundingStatus: "PASSED",
        groundingRetryCount: 0,
        curatorModelVersion: "an-old-prompt-version",
        fellBackToSelectionOnly: false,
      },
    }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a stale Project Knowledge Model status hides the cached analytics result", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ status: "stale", version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a non-live execution never exposes an old analytics result", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "STALE" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a completed empty-catalog result with no Project Knowledge Model is not marked stale", async () => {
  // Regression test: a project with verified interpretation data but no
  // Project Knowledge Model built yet (buildProjectKnowledgeModel.ts has
  // never been run) legitimately produces an empty catalog with
  // knowledgeModelVersion: 0. That result is current relative to "no
  // model exists" — it must not be shown as stale, which would
  // contradict the empty-evidence state the UI shows right next to it.
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 0 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "COMPLETED");
});

test("a result computed from a real model that has since disappeared is marked stale", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 3 }),
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
});

test("a FAILED execution is returned as-is, never re-checked for staleness", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 99 }),
    execution: makeExecution({
      status: "FAILED",
      errorCode: "analytics_generation_failed",
    }),
    result: null,
  });
  const service = new AnalyticsQueryService(
    authorizationService,
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
  );

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "FAILED");
});
