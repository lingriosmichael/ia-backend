import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import { ProjectDerivedStateInvalidationService } from "./projectDerivedStateInvalidationService.js";

test("invalidateProject marks the knowledge model stale and deletes project analytics snapshots", async () => {
  const calls: string[] = [];

  const projectKnowledgeModelRepository = {
    markStale: async (projectId: string) => {
      calls.push(`markStale:${projectId}`);
      return null;
    },
  } as unknown as ProjectKnowledgeModelRepository;

  const analyticsExecutionRepository = {
    deleteByProjectId: async (projectId: string) => {
      calls.push(`deleteExecutions:${projectId}`);
      return 1;
    },
  } as unknown as AnalyticsExecutionRepository;

  const analyticsResultRepository = {
    deleteByProjectId: async (projectId: string) => {
      calls.push(`deleteResults:${projectId}`);
      return 2;
    },
  } as unknown as AnalyticsResultRepository;

  const analyticsDashboardPreferenceRepository = {
    deleteByProjectId: async (projectId: string) => {
      calls.push(`deleteLayoutPreferences:${projectId}`);
      return 1;
    },
  } as unknown as AnalyticsDashboardPreferenceRepository;

  const service = new ProjectDerivedStateInvalidationService(
    projectKnowledgeModelRepository,
    analyticsExecutionRepository,
    analyticsResultRepository,
    analyticsDashboardPreferenceRepository,
  );

  await service.invalidateProject("project-1", null);

  assert.deepEqual(
    new Set(calls),
    new Set([
      "markStale:project-1",
      "deleteExecutions:project-1",
      "deleteResults:project-1",
      "deleteLayoutPreferences:project-1",
    ]),
  );
});
