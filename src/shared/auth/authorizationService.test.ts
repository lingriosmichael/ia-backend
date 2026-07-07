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
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: null,
        impact: null,
        outcomes: null,
      },
      successIndicators: null,
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

  const context = await authorizationService.canViewProject(
    "user-1",
    "project-1",
  );

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
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: null,
        impact: null,
        outcomes: null,
      },
      successIndicators: null,
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

test("authorization service lets an organization admin transfer ownership of a project they don't own", async () => {
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
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: null,
        impact: null,
        outcomes: null,
      },
      successIndicators: null,
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

  const context = await authorizationService.canTransferProjectOwnership(
    "user-1",
    "project-1",
  );

  assert.equal(context.membership.role, "ORGANIZATION_ADMIN");
});

test("authorization service blocks a project manager from transferring ownership of a project they don't own", async () => {
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
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      sdgs: [],
      impactModel: {
        inputs: null,
        activities: null,
        outputs: null,
        impact: null,
        outcomes: null,
      },
      successIndicators: null,
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

  // A non-owner PROJECT_MANAGER is already rejected by canViewProject
  // itself (project_access_denied) before any transfer-specific rule
  // could apply — there's no PROJECT_MANAGER who can view a project they
  // don't own, so there's nothing left for a transfer-specific denial to
  // catch.
  await assert.rejects(
    authorizationService.canTransferProjectOwnership("user-1", "project-1"),
    (error: unknown) =>
      error instanceof AppError && error.code === "project_access_denied",
  );
});
