import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsDashboardPreferenceService } from "./analyticsDashboardPreferenceService.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsDashboardPreferenceUpsertInput } from "./analyticsDashboardPreferencePersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import { FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION } from "./analyticsDashboardCompatibility.js";
import {
  createFakeAuthorization,
  makeProject,
  NOW,
} from "./analyticsTestFixtures.js";

test("legacy analytics results without a stored dashboard still accept persisted layout preferences", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const analyticsResultRepository = {
    findLatestByScope: async () => ({
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
              interpretationResultId: "interpretation-1",
              sourceReference: "Attendance rate",
            },
          },
        ],
        omittedEntries: [],
        qualitySignals: [],
      },
      curation: {
        featuredEntryIds: ["metric-1"],
        narrative: [
          {
            text: "Attendance remained stable.",
            referencedEntryIds: ["metric-1"],
          },
        ],
        groundingStatus: "PASSED",
        groundingRetryCount: 0,
        curatorModelVersion: "curator-prompt-v1",
        fellBackToSelectionOnly: false,
      },
      dashboard: null,
      dataQuality: {
        recordsExcludedCount: 0,
        warnings: [],
      },
      limitations: [],
      generatedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as AnalyticsResultRepository;

  const upsertCalls: AnalyticsDashboardPreferenceUpsertInput[] = [];
  const analyticsDashboardPreferenceRepository = {
    upsertByScope: async (input: AnalyticsDashboardPreferenceUpsertInput) => {
      upsertCalls.push(input);
      return {
        id: "layout-1",
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
    deleteByScope: async () => 1,
  } as unknown as AnalyticsDashboardPreferenceRepository;

  const service = new AnalyticsDashboardPreferenceService(
    authorizationService,
    analyticsResultRepository,
    analyticsDashboardPreferenceRepository,
  );

  const preference = await service.updateProjectPreference(
    "user-1",
    "project-1",
    {
      dashboardSchemaVersion: FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
      orderedWidgetIds: ["summary-fallback"],
      hiddenWidgetIds: ["kpi-metric-1"],
    },
  );

  assert.equal(
    preference.dashboardSchemaVersion,
    FALLBACK_ANALYTICS_DASHBOARD_SCHEMA_VERSION,
  );
  assert.equal(upsertCalls.length, 1);
  const persistedPreference = upsertCalls[0]!;
  assert.deepEqual(persistedPreference.orderedWidgetIds, [
    "summary-fallback",
    "kpi-metric-1",
  ]);
  assert.deepEqual(persistedPreference.hiddenWidgetIds, ["kpi-metric-1"]);
});
