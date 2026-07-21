import assert from "node:assert/strict";
import test from "node:test";
import { ReportReadinessCheckService } from "./reportReadinessCheckService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { DashboardCatalogAssemblerService } from "../analytics/dashboardCatalogAssemblerService.js";
import type { PythonAnalyticsCurationClient } from "../analytics/pythonAnalyticsCurationClient.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import {
  REPORT_READINESS_MODEL_VERSION,
  type EvidenceCatalog,
  type ReportReadinessActivityCoverage,
  type ReportReadinessOpenQuestion,
} from "../analytics/analyticsContracts.js";
import type { ProjectKnowledgeModelStatus } from "../../shared/contracts.js";
import {
  createFakeAuthorization,
  makeProject,
} from "../analytics/analyticsTestFixtures.js";

function emptyCatalog(): EvidenceCatalog {
  return {
    catalogVersion: "3.0",
    knowledgeModelVersion: 1,
    scope: { type: "PROJECT", projectId: "project-1", activityId: null },
    entries: [],
    omittedEntries: [],
    qualitySignals: [],
  };
}

function createFakeActivityRepository(
  activities: Array<{
    id: string;
    name: string;
    interpretationAcknowledgedAt: Date | null;
  }>,
) {
  return {
    listByProject: async () =>
      activities.map((activity) => ({
        ...activity,
        projectId: "project-1",
      })),
  } as unknown as ActivityRepository;
}

function createFakeUploadRepository(
  uploads: Array<{ id: string; activityId: string }>,
) {
  return {
    listByActivityIds: async () => uploads,
  } as unknown as UploadMetadataRepository;
}

function createFakeInterpretationResultRepository(
  results: Array<{
    activityId: string;
    questions: Array<{
      id: string;
      prompt: string;
      questionDomain: "preparation" | "interpretation";
      isBlocking: boolean;
      kind: "single_choice" | "free_text" | "merge_confirmation";
      status: "pending" | "answered";
    }>;
  }>,
) {
  return {
    findLatestByUploadMetadataIds: async () => results,
  } as unknown as InterpretationResultRepository;
}

function createFakeProjectRepository() {
  const updates: Array<{ projectId: string; input: unknown }> = [];
  const repository = {
    update: async (projectId: string, input: unknown) => {
      updates.push({ projectId, input });
      return { ...makeProject(), ...(input as object) };
    },
  } as unknown as ProjectRepository;
  return { repository, updates };
}

function createFakeProjectKnowledgeBuilderService(onBuild?: () => void) {
  return {
    buildForProject: async () => {
      onBuild?.();
      return {} as never;
    },
  } as unknown as ProjectKnowledgeBuilderService;
}

function createFakeAssembler(
  results: Array<{
    catalog: EvidenceCatalog;
    projectKnowledgeModelStatus: ProjectKnowledgeModelStatus | null;
  }>,
) {
  let callIndex = 0;
  return {
    assemble: async () => {
      const result = results[Math.min(callIndex, results.length - 1)]!;
      callIndex += 1;
      return { ...result, scopedInterpretationResultIds: [] };
    },
  } as unknown as DashboardCatalogAssemblerService;
}

function createFakePythonClient(
  response: {
    overallReadiness: { level: "not_ready"; rationale: string };
    evidenceSummary: never[];
    confidentlyReportable: never[];
    reportableWithCaveats: never[];
    missingOrWeakEvidence: never[];
    deviationsRequiringExplanation: never[];
    honestEmergingStory: { narrative: string; sourceEntryIds: never[] };
    actionsBeforeReporting: never[];
    improvementsForNextPeriod: never[];
    groundingStatus: "PASSED";
    groundingRetryCount: number;
    reportReadinessModelVersion: string;
    fellBackToSelectionOnly: boolean;
    llmUsage: null;
  },
  captureCallArgs?: (args: {
    openQuestions: ReportReadinessOpenQuestion[];
    activityCoverage: ReportReadinessActivityCoverage[];
  }) => void,
) {
  return {
    generateReportReadinessCheck: async (
      _catalog: unknown,
      _projectContext: unknown,
      openQuestions: ReportReadinessOpenQuestion[],
      activityCoverage: ReportReadinessActivityCoverage[],
    ) => {
      captureCallArgs?.({ openQuestions, activityCoverage });
      return response;
    },
  } as unknown as PythonAnalyticsCurationClient;
}

function createFakeLedgerService() {
  return {
    recordUsage: async () => {},
    recordUsages: async () => {},
  } as unknown as ProjectLlmTokenLedgerService;
}

const NOT_READY_RESPONSE = {
  overallReadiness: {
    level: "not_ready" as const,
    rationale: "No interpreted evidence is available yet for this project.",
  },
  evidenceSummary: [] as never[],
  confidentlyReportable: [] as never[],
  reportableWithCaveats: [] as never[],
  missingOrWeakEvidence: [] as never[],
  deviationsRequiringExplanation: [] as never[],
  honestEmergingStory: {
    narrative: "No interpreted evidence is available yet for this project.",
    sourceEntryIds: [] as never[],
  },
  actionsBeforeReporting: [] as never[],
  improvementsForNextPeriod: [] as never[],
  groundingStatus: "PASSED" as const,
  groundingRetryCount: 0,
  reportReadinessModelVersion: REPORT_READINESS_MODEL_VERSION,
  fellBackToSelectionOnly: false as const,
  llmUsage: null,
};

test("getReportReadinessCheck throws 409 when no snapshot has ever been generated", async () => {
  const project = makeProject({ reportReadinessCheckSnapshot: null });
  const authorizationService = createFakeAuthorization(project);
  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: null },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE),
    createFakeLedgerService(),
  );

  await assert.rejects(
    () => service.getReportReadinessCheck("user-1", "project-1"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no Report Readiness Check yet/);
      return true;
    },
  );
});

test("getReportReadinessCheck returns the persisted snapshot", async () => {
  const snapshot = {
    ...NOT_READY_RESPONSE,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  delete (snapshot as { llmUsage?: unknown }).llmUsage;
  const project = makeProject({
    reportReadinessCheckSnapshot: snapshot as never,
  });
  const authorizationService = createFakeAuthorization(project);
  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: null },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE),
    createFakeLedgerService(),
  );

  const result = await service.getReportReadinessCheck("user-1", "project-1");

  assert.equal(result.overallReadiness.level, "not_ready");
});

test("getReportReadinessCheck throws 409 for a snapshot from an older prompt/schema version instead of returning it", async () => {
  const staleSnapshot = {
    ...NOT_READY_RESPONSE,
    reportReadinessModelVersion: "report-readiness-prompt-v0",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  delete (staleSnapshot as { llmUsage?: unknown }).llmUsage;
  const project = makeProject({
    reportReadinessCheckSnapshot: staleSnapshot as never,
  });
  const authorizationService = createFakeAuthorization(project);
  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: null },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE),
    createFakeLedgerService(),
  );

  await assert.rejects(
    () => service.getReportReadinessCheck("user-1", "project-1"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no Report Readiness Check yet/);
      return true;
    },
  );
});

test("generateReportReadinessCheck only sends pending questions and reflects activity coverage", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  let capturedArgs:
    | {
        openQuestions: ReportReadinessOpenQuestion[];
        activityCoverage: ReportReadinessActivityCoverage[];
      }
    | undefined;

  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([
      {
        id: "activity-1",
        name: "Mentor training",
        interpretationAcknowledgedAt: new Date(),
      },
      {
        id: "activity-2",
        name: "Follow-up interviews",
        interpretationAcknowledgedAt: null,
      },
    ]),
    createFakeUploadRepository([
      { id: "upload-1", activityId: "activity-1" },
      { id: "upload-2", activityId: "activity-2" },
    ]),
    createFakeInterpretationResultRepository([
      {
        activityId: "activity-1",
        questions: [
          {
            id: "question-1",
            prompt: "Which column holds the primary date?",
            questionDomain: "preparation",
            isBlocking: true,
            kind: "single_choice",
            status: "pending",
          },
          {
            id: "question-2",
            prompt: "Already answered",
            questionDomain: "preparation",
            isBlocking: true,
            kind: "single_choice",
            status: "answered",
          },
        ],
      },
      {
        activityId: "activity-2",
        questions: [],
      },
    ]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: "ready" },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE, (args) => {
      capturedArgs = args;
    }),
    createFakeLedgerService(),
  );

  await service.generateReportReadinessCheck("user-1", "project-1", "en");

  assert.ok(capturedArgs);
  assert.equal(capturedArgs.openQuestions.length, 1);
  assert.equal(capturedArgs.openQuestions[0]?.questionId, "question-1");
  assert.equal(capturedArgs.activityCoverage.length, 2);
  const activity1Coverage = capturedArgs.activityCoverage.find(
    (item) => item.activityId === "activity-1",
  );
  const activity2Coverage = capturedArgs.activityCoverage.find(
    (item) => item.activityId === "activity-2",
  );
  assert.equal(activity1Coverage?.isAcknowledged, true);
  assert.equal(activity1Coverage?.hasFullyInterpretedEvidence, true);
  assert.equal(activity2Coverage?.isAcknowledged, false);
  assert.equal(activity2Coverage?.hasFullyInterpretedEvidence, true);
});

test("a stale Project Knowledge Model triggers a rebuild, then proceeds using the freshly-rebuilt catalog", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  let rebuildCount = 0;

  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(() => {
      rebuildCount += 1;
    }),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: "stale" },
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: "ready" },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE),
    createFakeLedgerService(),
  );

  await service.generateReportReadinessCheck("user-1", "project-1", "en");

  assert.equal(rebuildCount, 1);
});

test("a Project Knowledge Model already being built is rejected with 409, never calls the python client", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  let pythonClientCalled = false;

  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    createFakeProjectRepository().repository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: "building" },
    ]),
    {
      generateReportReadinessCheck: async () => {
        pythonClientCalled = true;
        return NOT_READY_RESPONSE;
      },
    } as unknown as PythonAnalyticsCurationClient,
    createFakeLedgerService(),
  );

  await assert.rejects(() =>
    service.generateReportReadinessCheck("user-1", "project-1", "en"),
  );
  assert.equal(pythonClientCalled, false);
});

test("generateReportReadinessCheck persists the returned snapshot on the project", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const { repository: projectRepository, updates } =
    createFakeProjectRepository();

  const service = new ReportReadinessCheckService(
    authorizationService,
    createFakeActivityRepository([]),
    createFakeUploadRepository([]),
    createFakeInterpretationResultRepository([]),
    projectRepository,
    createFakeProjectKnowledgeBuilderService(),
    createFakeAssembler([
      { catalog: emptyCatalog(), projectKnowledgeModelStatus: "ready" },
    ]),
    createFakePythonClient(NOT_READY_RESPONSE),
    createFakeLedgerService(),
  );

  const result = await service.generateReportReadinessCheck(
    "user-1",
    "project-1",
    "en",
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.projectId, "project-1");
  assert.equal(result.overallReadiness.level, "not_ready");
  assert.ok(result.generatedAt instanceof Date);
});
