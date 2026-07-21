import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsQueryService } from "./analyticsQueryService.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsDashboardEventRepository } from "./analyticsDashboardEventRepository.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsDashboardEventPersistenceRecord } from "./analyticsDashboardEventPersistence.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { AnalyticsResultPersistenceRecord } from "./analyticsResultPersistence.js";
import {
  ANALYTICS_DASHBOARD_SCHEMA_VERSION,
  CURATOR_MODEL_VERSION,
} from "./analyticsContracts.js";
import { FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION } from "./analyticsDashboardCompatibility.js";
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
    dashboard: null,
    dataQuality: { recordsExcludedCount: 0, warnings: [] },
    limitations: [],
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeLayoutPreference(
  overrides: {
    dashboardSchemaVersion?: string;
    orderedWidgetIds?: string[];
    hiddenWidgetIds?: string[];
  } = {},
) {
  return {
    id: "layout-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: null,
    scopeType: "PROJECT" as const,
    dashboardSchemaVersion:
      overrides.dashboardSchemaVersion ?? ANALYTICS_DASHBOARD_SCHEMA_VERSION,
    orderedWidgetIds: overrides.orderedWidgetIds ?? [
      "summary-primary",
      "kpi-1",
    ],
    hiddenWidgetIds: overrides.hiddenWidgetIds ?? ["kpi-1"],
    updatedById: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createFakeRepos(options: {
  model: ReturnType<typeof makeKnowledgeModel> | null;
  execution: AnalyticsExecutionPersistenceRecord | null;
  result: AnalyticsResultPersistenceRecord | null;
  layoutPreference?: ReturnType<typeof makeLayoutPreference> | null;
  dashboardEvents?: AnalyticsDashboardEventPersistenceRecord[];
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

  const analyticsDashboardPreferenceRepository = {
    findByScope: async () => options.layoutPreference ?? null,
    deleteByProjectId: async () => 0,
  } as unknown as AnalyticsDashboardPreferenceRepository;

  const analyticsDashboardEventRepository = {
    findByScopeAndResultId: async () => options.dashboardEvents ?? [],
    deleteByProjectId: async () => 0,
    deleteByActivityId: async () => 0,
    create: async () => {
      throw new Error("not implemented");
    },
  } as unknown as AnalyticsDashboardEventRepository;

  return {
    projectKnowledgeModelRepository,
    analyticsExecutionRepository,
    analyticsResultRepository,
    analyticsDashboardPreferenceRepository,
    analyticsDashboardEventRepository,
    getCurrentExecution: () => currentExecution,
  };
}

function createService(
  repos: ReturnType<typeof createFakeRepos>,
  project = makeProject(),
) {
  return new AnalyticsQueryService(
    createFakeAuthorization(project),
    repos.projectKnowledgeModelRepository,
    repos.analyticsExecutionRepository,
    repos.analyticsResultRepository,
    repos.analyticsDashboardPreferenceRepository,
    repos.analyticsDashboardEventRepository,
  );
}

test("no execution or result yet returns nulls without touching staleness logic", async () => {
  const repos = createFakeRepos({ model: null, execution: null, result: null });
  const service = createService(repos);

  const { execution, result, layoutPreference, dashboardCompatibilitySource } =
    await service.getProjectAnalytics("user-1", "project-1");

  assert.equal(execution, null);
  assert.equal(result, null);
  assert.equal(layoutPreference, null);
  assert.equal(dashboardCompatibilitySource, null);
});

test("a completed result matching the current model/curator version is not marked stale", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = createService(repos);

  const { execution, result, dashboardCompatibilitySource } =
    await service.getProjectAnalytics("user-1", "project-1");

  assert.equal(execution!.status, "COMPLETED");
  assert.equal(
    result?.dashboard?.schemaVersion,
    FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
  );
  assert.equal(dashboardCompatibilitySource, "compatibility_fallback");
});

test("dashboard usage summary is returned for the current result when telemetry exists", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
    dashboardEvents: [
      {
        id: "event-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: null,
        scopeType: "PROJECT",
        userId: "user-1",
        resultId: "result-1",
        interactionType: "dashboard_viewed",
        dashboardSchemaVersion: FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
        dashboardCompatibilitySource: "compatibility_fallback",
        orderedWidgetIds: [],
        hiddenWidgetIds: [],
        visibleWidgetIds: [],
        widgetId: null,
        occurredAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "event-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: null,
        scopeType: "PROJECT",
        userId: "user-1",
        resultId: "result-1",
        interactionType: "widget_hidden",
        dashboardSchemaVersion: FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
        dashboardCompatibilitySource: "compatibility_fallback",
        orderedWidgetIds: [],
        hiddenWidgetIds: [],
        visibleWidgetIds: [],
        widgetId: "kpi-metric-1",
        occurredAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
  const service = createService(repos);

  const { dashboardUsageSummary } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(dashboardUsageSummary?.resultId, "result-1");
  assert.equal(dashboardUsageSummary?.totalEvents, 2);
  assert.equal(dashboardUsageSummary?.dashboardViewCount, 1);
  assert.equal(dashboardUsageSummary?.widgetHideCount, 1);
  assert.equal(dashboardUsageSummary?.widgetShowCount, 0);
});

test("a Project Knowledge Model version bump marks a completed result STALE", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 2 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = createService(repos);

  const { execution, result, layoutPreference, dashboardCompatibilitySource } =
    await service.getProjectAnalytics("user-1", "project-1");

  assert.equal(execution!.status, "STALE");
  assert.equal(repos.getCurrentExecution()!.status, "STALE");
  assert.equal(result, null);
  assert.equal(layoutPreference, null);
  assert.equal(dashboardCompatibilitySource, null);
});

test("a curator model version mismatch also marks a completed result STALE", async () => {
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
  const service = createService(repos);

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a stale Project Knowledge Model status hides the cached analytics result", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ status: "stale", version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = createService(repos);

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a non-live execution never exposes an old analytics result", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "STALE" }),
    result: makeResult({ knowledgeModelVersion: 1 }),
  });
  const service = createService(repos);

  const { execution, result } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
  assert.equal(result, null);
});

test("a completed empty-catalog result with no Project Knowledge Model is not marked stale", async () => {
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 0 }),
  });
  const service = createService(repos);

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "COMPLETED");
});

test("a result computed from a real model that has since disappeared is marked stale", async () => {
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({ knowledgeModelVersion: 3 }),
  });
  const service = createService(repos);

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "STALE");
});

test("a FAILED execution is returned as-is, never re-checked for staleness", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 99 }),
    execution: makeExecution({
      status: "FAILED",
      errorCode: "analytics_generation_failed",
    }),
    result: null,
  });
  const service = createService(repos);

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "FAILED");
});

test("an execution abandoned mid-flight (RUNNING far past a real run's duration) is healed to FAILED", async () => {
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({
      status: "RUNNING",
      startedAt: NOW,
      completedAt: null,
    }),
    result: null,
  });
  const service = createService(repos);

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "FAILED");
  assert.equal(repos.getCurrentExecution()!.status, "FAILED");
});

test("a genuinely in-progress execution (started moments ago) is left RUNNING, not prematurely healed", async () => {
  const repos = createFakeRepos({
    model: null,
    execution: makeExecution({
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
    }),
    result: null,
  });
  const service = createService(repos);

  const { execution } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.equal(execution!.status, "RUNNING");
});

test("a valid persisted layout preference is normalized and returned", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({
      knowledgeModelVersion: 1,
      dashboard: {
        schemaVersion: ANALYTICS_DASHBOARD_SCHEMA_VERSION,
        availableWidgets: [
          {
            widgetId: "summary-primary",
            kind: "summary",
            title: "In plain language",
            subtitle: null,
            description: "Summary",
            sourceActivityIds: [],
            sourceUploadMetadataIds: [],
            goalLinkage: {
              outcomeReferences: [],
              successIndicators: [],
              matchedProjectGoalPhrases: [],
            },
            qualityFlags: [],
            paragraphs: ["Summary"],
            referencedEntryIds: [],
          },
          {
            widgetId: "kpi-1",
            kind: "kpi",
            title: "Attendance rate",
            subtitle: null,
            description: "Share of participants attending sessions.",
            sourceActivityIds: ["activity-1"],
            sourceUploadMetadataIds: ["upload-1"],
            goalLinkage: {
              outcomeReferences: [],
              successIndicators: [],
              matchedProjectGoalPhrases: [],
            },
            qualityFlags: [],
            entryId: "metric-1",
            label: "Attendance rate",
            value: 0.82,
            unit: "ratio",
            deduplicationConfidence: "not_applicable",
          },
          {
            widgetId: "theme-1",
            kind: "theme_list",
            title: "Qualitative signals",
            subtitle: null,
            description: "Themes",
            sourceActivityIds: ["activity-1"],
            sourceUploadMetadataIds: ["upload-2"],
            goalLinkage: {
              outcomeReferences: [],
              successIndicators: [],
              matchedProjectGoalPhrases: [],
            },
            qualityFlags: [],
            items: [],
          },
        ],
        defaultLayout: {
          orderedWidgetIds: ["summary-primary", "kpi-1", "theme-1"],
          hiddenWidgetIds: [],
        },
      },
    }),
    layoutPreference: makeLayoutPreference({
      orderedWidgetIds: ["kpi-1", "missing-widget", "summary-primary"],
      hiddenWidgetIds: ["kpi-1", "missing-widget"],
    }),
  });
  const service = createService(repos);

  const { layoutPreference } = await service.getProjectAnalytics(
    "user-1",
    "project-1",
  );

  assert.deepEqual(layoutPreference?.orderedWidgetIds, [
    "kpi-1",
    "summary-primary",
    "theme-1",
  ]);
  assert.deepEqual(layoutPreference?.hiddenWidgetIds, ["kpi-1"]);
});

test("a legacy result with no stored dashboard still returns a materialized fallback dashboard and compatible layout preference", async () => {
  const repos = createFakeRepos({
    model: makeKnowledgeModel({ version: 1 }),
    execution: makeExecution({ status: "COMPLETED" }),
    result: makeResult({
      knowledgeModelVersion: 1,
      catalog: {
        catalogVersion: "3.0",
        knowledgeModelVersion: 1,
        scope: { type: "PROJECT", projectId: "project-1", activityId: null },
        entries: [
          {
            entryId: "metric-1",
            entryType: "METRIC",
            label: "Attendance rate",
            description: "Share of participants attending sessions.",
            value: 0.82,
            unit: "ratio",
            deduplicationConfidence: "not_applicable",
            activityId: "activity-1",
            provenance: {
              knowledgeEntityId: "entity-1",
              uploadMetadataId: "upload-1",
              interpretationResultId: "result-1",
              sourceReference: "Attendance rate",
            },
            evidenceStrength: "strong",
          },
          {
            entryId: "theme-1",
            entryType: "QUALITATIVE_THEME",
            label: "Mentors requested more preparation time",
            description: "Interviewees described compressed onboarding.",
            quoteCount: 3,
            categories: ["barrier"],
            outcomeReferences: ["Participants sustain mentor relationships."],
            outcomeAnchorTypes: ["project_outcome"],
            sourceActivityIds: ["activity-1"],
            sourceUploadMetadataIds: ["upload-2"],
            sourceInstances: [
              {
                uploadMetadataId: "upload-2",
                interpretationResultId: "result-2",
                sourceReference: "Mentors requested more preparation time",
              },
            ],
          },
        ],
        omittedEntries: [],
        qualitySignals: [],
      },
      curation: {
        featuredEntryIds: ["metric-1", "theme-1"],
        narrative: [
          {
            text: "Attendance held steady while onboarding remained compressed.",
            referencedEntryIds: ["metric-1", "theme-1"],
          },
        ],
        groundingStatus: "PASSED",
        groundingRetryCount: 0,
        curatorModelVersion: CURATOR_MODEL_VERSION,
        fellBackToSelectionOnly: false,
      },
      dashboard: null,
    }),
    layoutPreference: makeLayoutPreference({
      dashboardSchemaVersion: FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
      orderedWidgetIds: ["theme-list-fallback", "summary-fallback"],
      hiddenWidgetIds: ["theme-list-fallback"],
    }),
  });
  const service = createService(repos);

  const { result, layoutPreference, dashboardCompatibilitySource } =
    await service.getProjectAnalytics("user-1", "project-1");

  assert.equal(
    result?.dashboard?.schemaVersion,
    FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
  );
  assert.equal(dashboardCompatibilitySource, "compatibility_fallback");
  assert.deepEqual(result?.dashboard?.defaultLayout.orderedWidgetIds, [
    "kpi-metric-1",
    "summary-fallback",
    "theme-list-fallback",
  ]);
  assert.deepEqual(layoutPreference?.orderedWidgetIds, [
    "theme-list-fallback",
    "summary-fallback",
    "kpi-metric-1",
  ]);
  assert.deepEqual(layoutPreference?.hiddenWidgetIds, ["theme-list-fallback"]);
});
