import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsExecutionService } from "./analyticsExecutionService.js";
import { AnalyticsDashboardBuilderService } from "./analyticsDashboardBuilderService.js";
import type { DashboardCatalogAssemblerService } from "./dashboardCatalogAssemblerService.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { PythonAnalyticsCurationClient } from "./pythonAnalyticsCurationClient.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type {
  DashboardCuration,
  EvidenceCatalog,
} from "./analyticsContracts.js";
import { CURATOR_MODEL_VERSION } from "./analyticsContracts.js";
import {
  createFakeAuthorization,
  makeProject,
} from "./analyticsTestFixtures.js";

function createFakeExecutionRepository() {
  const executions: AnalyticsExecutionPersistenceRecord[] = [];
  const repository = {
    create: async (input: {
      organizationId: string;
      projectId: string;
      activityId: string | null;
      scopeType: "PROJECT" | "ACTIVITY";
      language: "de" | "en";
      status: string;
      startedAt: Date | null;
    }) => {
      const created = {
        id: `execution-${executions.length + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        activityId: input.activityId,
        scopeType: input.scopeType,
        language: input.language,
        status: input.status,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        attemptCount: 0,
        nextAttemptAt: null,
        maxAttempts: 10,
        startedAt: input.startedAt,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AnalyticsExecutionPersistenceRecord;
      executions.push(created);
      return created;
    },
    update: async (
      id: string,
      update: Partial<AnalyticsExecutionPersistenceRecord> & {
        status: string;
      },
    ) => {
      const index = executions.findIndex((execution) => execution.id === id);
      if (index === -1) {
        return null;
      }
      const updated = {
        ...executions[index],
        ...update,
      } as AnalyticsExecutionPersistenceRecord;
      executions[index] = updated;
      return updated;
    },
    findById: async (id: string) =>
      executions.find((execution) => execution.id === id) ?? null,
    findLatestByScope: async () => null,
    claimNextRunnable: async () => null,
    renewLease: async () => null,
  } as unknown as AnalyticsExecutionRepository;

  return { repository, executions };
}

function createFakeResultRepository() {
  const results: unknown[] = [];
  const repository = {
    create: async (input: unknown) => {
      results.push(input);
      return input as never;
    },
    findLatestByScope: async () => null,
  } as unknown as AnalyticsResultRepository;
  return { repository, results };
}

function fakeCatalog(entryCount: number): EvidenceCatalog {
  return {
    catalogVersion: "3.0",
    knowledgeModelVersion: 1,
    scope: { type: "PROJECT", projectId: "project-1", activityId: null },
    entries: Array.from({ length: entryCount }, (_unused, index) => ({
      entryId: `metric-${index}`,
      entryType: "METRIC" as const,
      label: "Attendance rate",
      description: "desc",
      value: 0.8,
      unit: "ratio",
      deduplicationConfidence: "not_applicable" as const,
      activityId: "activity-1",
      provenance: {
        knowledgeEntityId: "entity-1",
        uploadMetadataId: "upload-1",
        interpretationResultId: "result-1",
        sourceReference: "Attendance rate",
      },
      evidenceStrength: "strong" as const,
    })),
    omittedEntries: [],
    qualitySignals: [],
  };
}

function createFakeProjectKnowledgeBuilderService(
  onBuild?: (projectId: string) => void,
) {
  return {
    buildForProject: async (projectId: string) => {
      onBuild?.(projectId);
      return {} as never;
    },
  } as unknown as ProjectKnowledgeBuilderService;
}

function createFakeDeterministicAnalysisRepository() {
  return {
    findByInterpretationResultIds: async () => [],
  } as unknown as DeterministicAnalysisRepository;
}

function createFakeProjectLlmTokenLedgerService() {
  return {
    recordUsage: async () => {},
    recordUsages: async () => {},
  } as unknown as ProjectLlmTokenLedgerService;
}

function createFakeProjectRepository(project = makeProject()) {
  return {
    findById: async () => project,
  } as unknown as ProjectRepository;
}

const PASSING_CURATION: DashboardCuration = {
  featuredEntryIds: ["metric-0"],
  narrative: [],
  groundingStatus: "PASSED",
  groundingRetryCount: 0,
  curatorModelVersion: CURATOR_MODEL_VERSION,
  fellBackToSelectionOnly: false,
};

test("generateForProject with a populated catalog calls the curator and completes", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository, executions } =
    createFakeExecutionRepository();
  const { repository: resultRepository, results } =
    createFakeResultRepository();
  let curateCallCount = 0;
  let requestedLanguage: "de" | "en" | null = null;
  const curationClient = {
    curate: async (
      _catalog: EvidenceCatalog,
      _projectContext: unknown,
      language: "de" | "en",
    ) => {
      curateCallCount += 1;
      requestedLanguage = language;
      return PASSING_CURATION;
    },
  } as unknown as PythonAnalyticsCurationClient;

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    createFakeProjectKnowledgeBuilderService(),
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject(
    "user-1",
    "project-1",
    "en",
  );

  assert.equal(curateCallCount, 1);
  assert.equal(requestedLanguage, "en");
  assert.equal(execution.status, "COMPLETED");
  assert.equal(results.length, 1);
  assert.equal(executions[0]!.status, "COMPLETED");
  assert.equal(
    (
      results[0] as {
        dashboard: {
          availableWidgets: unknown[];
          defaultLayout: { orderedWidgetIds: string[] };
        };
      }
    ).dashboard.availableWidgets.length > 0,
    true,
  );
  assert.equal(
    (
      results[0] as {
        dashboard: {
          availableWidgets: unknown[];
          defaultLayout: { orderedWidgetIds: string[] };
        };
      }
    ).dashboard.defaultLayout.orderedWidgetIds.length > 0,
    true,
  );
});

test("an empty catalog completes without ever calling the curator", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(0),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: [],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository } = createFakeResultRepository();
  let curateCallCount = 0;
  const curationClient = {
    curate: async () => {
      curateCallCount += 1;
      return PASSING_CURATION;
    },
  } as unknown as PythonAnalyticsCurationClient;

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    createFakeProjectKnowledgeBuilderService(),
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject("user-1", "project-1");

  assert.equal(curateCallCount, 0);
  assert.equal(execution.status, "COMPLETED");
});

test("a stale Project Knowledge Model triggers a rebuild, then proceeds using the freshly-rebuilt catalog", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  let assembleCallCount = 0;
  const assembler = {
    assemble: async () => {
      assembleCallCount += 1;
      // First call (pre-rebuild) reports stale; second call (post-rebuild,
      // triggered by the service itself) reports ready.
      return {
        catalog: fakeCatalog(1),
        projectKnowledgeModelStatus:
          assembleCallCount === 1 ? "stale" : "ready",
        scopedInterpretationResultIds: ["result-1"],
      };
    },
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository, results } =
    createFakeResultRepository();
  const curationClient = {
    curate: async () => PASSING_CURATION,
  } as unknown as PythonAnalyticsCurationClient;
  let buildCallCount = 0;
  const projectKnowledgeBuilderService =
    createFakeProjectKnowledgeBuilderService(() => {
      buildCallCount += 1;
    });

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    projectKnowledgeBuilderService,
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject("user-1", "project-1");

  assert.equal(buildCallCount, 1);
  assert.equal(assembleCallCount, 2);
  assert.equal(results.length, 1);
  assert.equal(execution.status, "COMPLETED");
});

test("no Project Knowledge Model yet (never built) also triggers a rebuild instead of failing", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  let assembleCallCount = 0;
  const assembler = {
    assemble: async () => {
      assembleCallCount += 1;
      return {
        catalog: fakeCatalog(assembleCallCount === 1 ? 0 : 1),
        projectKnowledgeModelStatus: assembleCallCount === 1 ? null : "ready",
        scopedInterpretationResultIds:
          assembleCallCount === 1 ? [] : ["result-1"],
      };
    },
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository, results } =
    createFakeResultRepository();
  const curationClient = {
    curate: async () => PASSING_CURATION,
  } as unknown as PythonAnalyticsCurationClient;
  let buildCallCount = 0;
  const projectKnowledgeBuilderService =
    createFakeProjectKnowledgeBuilderService(() => {
      buildCallCount += 1;
    });

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    projectKnowledgeBuilderService,
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject("user-1", "project-1");

  assert.equal(buildCallCount, 1);
  assert.equal(results.length, 1);
  assert.equal(execution.status, "COMPLETED");
});

test("a Project Knowledge Model already being built is left alone, never triggers a concurrent rebuild", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "building",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository, results } =
    createFakeResultRepository();
  const curationClient = {
    curate: async () => PASSING_CURATION,
  } as unknown as PythonAnalyticsCurationClient;
  let buildCallCount = 0;
  const projectKnowledgeBuilderService =
    createFakeProjectKnowledgeBuilderService(() => {
      buildCallCount += 1;
    });

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    projectKnowledgeBuilderService,
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject("user-1", "project-1");

  assert.equal(buildCallCount, 0);
  assert.equal(results.length, 0);
  assert.equal(execution.status, "QUEUED");
  assert.equal(execution.errorCode, null);
  assert.equal(execution.nextAttemptAt instanceof Date, true);
});

test("a ready Project Knowledge Model never triggers a redundant rebuild", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository } = createFakeResultRepository();
  const curationClient = {
    curate: async () => PASSING_CURATION,
  } as unknown as PythonAnalyticsCurationClient;
  let buildCallCount = 0;
  const projectKnowledgeBuilderService =
    createFakeProjectKnowledgeBuilderService(() => {
      buildCallCount += 1;
    });

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    projectKnowledgeBuilderService,
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  await service.generateForProject("user-1", "project-1");

  assert.equal(buildCallCount, 0);
});

test("a fallback curation marks the execution COMPLETED_WITH_WARNINGS, not COMPLETED", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository } = createFakeResultRepository();
  const curationClient = {
    curate: async () => ({
      ...PASSING_CURATION,
      fellBackToSelectionOnly: true,
    }),
  } as unknown as PythonAnalyticsCurationClient;

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    createFakeProjectKnowledgeBuilderService(),
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  const execution = await service.generateForProject("user-1", "project-1");

  assert.equal(execution.status, "COMPLETED_WITH_WARNINGS");
});

test("a curation client failure marks the execution FAILED and rethrows", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository, executions } =
    createFakeExecutionRepository();
  const { repository: resultRepository } = createFakeResultRepository();
  const curationClient = {
    curate: async () => {
      throw new Error("Python service unreachable.");
    },
  } as unknown as PythonAnalyticsCurationClient;

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    createFakeProjectKnowledgeBuilderService(),
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  await assert.rejects(
    () => service.generateForProject("user-1", "project-1"),
    /Python service unreachable/,
  );
  assert.equal(executions[0]!.status, "FAILED");
  assert.equal(executions[0]!.errorCode, "analytics_generation_failed");
});

test("generateForActivity rejects an activity that does not belong to the given project", async () => {
  const project = makeProject();
  const activityByIdMap = new Map([
    ["activity-1", { id: "activity-1", projectId: "different-project" }],
  ]);
  const authorizationService = createFakeAuthorization(
    project,
    activityByIdMap,
  );
  const assembler = {
    assemble: async () => ({
      catalog: fakeCatalog(1),
      projectKnowledgeModelStatus: "ready",
      scopedInterpretationResultIds: ["result-1"],
    }),
  } as unknown as DashboardCatalogAssemblerService;
  const { repository: executionRepository } = createFakeExecutionRepository();
  const { repository: resultRepository } = createFakeResultRepository();
  const curationClient = {
    curate: async () => PASSING_CURATION,
  } as unknown as PythonAnalyticsCurationClient;

  const service = new AnalyticsExecutionService(
    authorizationService,
    assembler,
    executionRepository,
    resultRepository,
    curationClient,
    createFakeProjectKnowledgeBuilderService(),
    createFakeDeterministicAnalysisRepository(),
    new AnalyticsDashboardBuilderService(),
    createFakeProjectLlmTokenLedgerService(),
    createFakeProjectRepository(project),
    { error: () => undefined } as never,
  );

  await assert.rejects(
    () => service.generateForActivity("user-1", "project-1", "activity-1"),
    /does not belong to the given project/,
  );
});
