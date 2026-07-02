import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../errors/appError.js";
import { AuthorizationService } from "./authorizationService.js";
import type { ActivityRepository } from "../../modules/activity/activityRepository.js";
import type { OrganizationRepository } from "../../modules/organization/organizationRepository.js";
import type { ProjectRepository } from "../../modules/project/projectRepository.js";

test("authorization service allows organization admins to view any project", async () => {
  const organizationRepository = {
    findMembership: async () => ({
      id: "membership-1",
      userId: "user-1",
      organizationId: "organization-1",
      role: "ORGANIZATION_ADMIN",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as OrganizationRepository;

  const projectRepository = {
    findById: async () => ({
      id: "project-1",
      organizationId: "organization-1",
      ownerId: "user-2",
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
    }),
  } as unknown as ProjectRepository;

  const activityRepository = {} as ActivityRepository;
  const authorizationService = new AuthorizationService(
    organizationRepository,
    projectRepository,
    activityRepository,
  );

  const context = await authorizationService.canViewProject("user-1", "project-1");

  assert.equal(context.membership.role, "ORGANIZATION_ADMIN");
  assert.equal(context.project.id, "project-1");
});

test("authorization service blocks project managers from viewing projects they do not own", async () => {
  const organizationRepository = {
    findMembership: async () => ({
      id: "membership-1",
      userId: "user-1",
      organizationId: "organization-1",
      role: "PROJECT_MANAGER",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as OrganizationRepository;

  const projectRepository = {
    findById: async () => ({
      id: "project-1",
      organizationId: "organization-1",
      ownerId: "user-2",
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
    }),
  } as unknown as ProjectRepository;

  const activityRepository = {} as ActivityRepository;
  const authorizationService = new AuthorizationService(
    organizationRepository,
    projectRepository,
    activityRepository,
  );

  await assert.rejects(
    authorizationService.canViewProject("user-1", "project-1"),
    (error: unknown) =>
      error instanceof AppError && error.code === "project_access_denied",
  );
});
