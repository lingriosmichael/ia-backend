import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsDashboardEventService } from "./analyticsDashboardEventService.js";
import type { AnalyticsDashboardEventRepository } from "./analyticsDashboardEventRepository.js";
import {
  createFakeAuthorization,
  makeProject,
} from "./analyticsTestFixtures.js";

test("trackProjectInteraction persists a normalized dashboard interaction event", async () => {
  const project = makeProject();
  const authorizationService = createFakeAuthorization(project);
  const createdInputs: unknown[] = [];
  const repository = {
    create: async (input: unknown) => {
      createdInputs.push(input);
      return {
        id: "event-1",
        ...((input as Record<string, unknown>) ?? {}),
        createdAt: new Date("2026-07-16T10:00:00.000Z"),
        updatedAt: new Date("2026-07-16T10:00:00.000Z"),
      };
    },
  } as unknown as AnalyticsDashboardEventRepository;

  const service = new AnalyticsDashboardEventService(
    authorizationService,
    repository,
  );

  await service.trackProjectInteraction("user-1", "project-1", {
    resultId: "result-1",
    interactionType: "widget_hidden",
    dashboardSchemaVersion: "dashboard-v2",
    dashboardCompatibilitySource: "generated",
    orderedWidgetIds: ["summary-primary", "kpi-1", "summary-primary"],
    hiddenWidgetIds: ["missing-widget", "kpi-1", "kpi-1"],
    visibleWidgetIds: ["summary-primary", "kpi-1", "summary-primary"],
    widgetId: "kpi-1",
  });

  assert.equal(createdInputs.length, 1);
  assert.deepEqual(createdInputs[0], {
    organizationId: "org-1",
    projectId: "project-1",
    activityId: null,
    scopeType: "PROJECT",
    userId: "user-1",
    resultId: "result-1",
    interactionType: "widget_hidden",
    dashboardSchemaVersion: "dashboard-v2",
    dashboardCompatibilitySource: "generated",
    orderedWidgetIds: ["summary-primary", "kpi-1"],
    hiddenWidgetIds: ["kpi-1"],
    visibleWidgetIds: ["summary-primary"],
    widgetId: "kpi-1",
    occurredAt:
      createdInputs[0] && (createdInputs[0] as { occurredAt: Date }).occurredAt,
  });
});
