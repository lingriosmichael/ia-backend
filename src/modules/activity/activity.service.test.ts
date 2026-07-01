import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectService } from "../project/project.service.js";
import type { ActivityRepository } from "./activity.repository.js";
import { ActivityService } from "./activity.service.js";

test("activity getById authorizes access through the project service", async () => {
  let authorizedProjectId: string | null = null;

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      slug: "activity-one",
      description: null,
      activityType: null,
      owner: null,
      startDate: null,
      endDate: null,
      objectives: null,
      expectedOutcomes: null,
      successIndicators: null,
      targetAudience: null,
      beneficiaryGroup: null,
      status: "planning",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
  } as unknown as ActivityRepository;

  const projectService = {
    getById: async (userId: string, projectId: string) => {
      assert.equal(userId, "user-1");
      authorizedProjectId = projectId;
      return {
        id: projectId,
        organizationId: "organization-1",
      };
    },
  } as unknown as ProjectService;

  const activityService = new ActivityService(
    activityRepository,
    projectService,
  );

  const activity = await activityService.getById("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
  assert.equal(authorizedProjectId, "project-1");
});
