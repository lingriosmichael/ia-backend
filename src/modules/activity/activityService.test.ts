import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "./activityRepository.js";
import { ActivityService } from "./activityService.js";

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

  const authorizationService = {
    canViewActivity: async (userId: string, activityId: string) => {
      assert.equal(userId, "user-1");
      assert.equal(activityId, "activity-1");
      authorizedProjectId = "project-1";
      return {
        membership: {
          id: "membership-1",
          userId,
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: {
          id: "project-1",
          organizationId: "organization-1",
          ownerId: userId,
          name: "Project One",
          slug: "project-one",
          description: null,
          programGoal: null,
          startMonth: null,
          endMonth: null,
          country: null,
          regionCity: null,
          sdgs: [],
          targetBeneficiaries: [],
          fundingSource: null,
          status: "planning",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        activity: {
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
          additionalContext: null,
          beneficiaryGroup: null,
          status: "planning",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      };
    },
  } as unknown as AuthorizationService;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
  );

  const activity = await activityService.getById("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
  assert.equal(authorizedProjectId, "project-1");
});
