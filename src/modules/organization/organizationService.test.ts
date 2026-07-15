import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import type { OrganizationRepository } from "./organizationRepository.js";
import { createOrganizationSettings } from "./organizationSettings.js";
import { OrganizationService } from "./organizationService.js";

test("organization workspace enriches activity upload counts from the upload repository", async () => {
  const organizationRepository = {
    findWorkspaceForUser: async () => ({
      id: "organization-1",
      name: "Example Org",
      mission: null,
      logoUrl: null,
      settings: createOrganizationSettings({
        organizationName: "Example Org",
      }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      memberships: [{ role: "ORGANIZATION_ADMIN" }],
    }),
    listMembershipsByOrganization: async () => [
      {
        id: "membership-1",
        userId: "user-1",
        organizationId: "organization-1",
        role: "ORGANIZATION_ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  } as unknown as OrganizationRepository;

  const projectRepository = {
    listByOrganization: async () => [
      {
        id: "project-1",
        organizationId: "organization-1",
        ownerId: "user-1",
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
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    ],
  } as unknown as ProjectRepository;

  const activityRepository = {
    listByProjectIds: async () => [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity One",
        description: null,
        activityType: null,
        owner: null,
        startDate: null,
        endDate: null,
        objectives: null,
        successIndicators: null,
        targetAudience: null,
        additionalContext: null,
        status: "active",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-06T00:00:00.000Z"),
      },
    ],
  } as unknown as ActivityRepository;

  const uploadMetadataRepository = {
    countByActivityIds: async () => ({
      "activity-1": 3,
    }),
  } as unknown as UploadMetadataRepository;

  const fileStorageService = {} as FileStorageService;
  const transactionManager = {} as TransactionManager;
  const authorizationService = {
    canViewOrganization: async () => ({
      membership: {
        id: "membership-1",
        userId: "user-1",
        organizationId: "organization-1",
        role: "ORGANIZATION_ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  } as unknown as AuthorizationService;
  const userRepository = {
    findByIds: async () => [
      {
        id: "user-1",
        email: "admin@example.org",
        fullName: "Org Admin",
        passwordHash: "hash",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  } as unknown as UserRepository;

  const organizationService = new OrganizationService(
    organizationRepository,
    fileStorageService,
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    transactionManager,
    authorizationService,
    userRepository,
  );

  const workspace = await organizationService.getWorkspace(
    "user-1",
    "organization-1",
  );

  assert.equal(workspace.projects[0]?.activities[0]?.uploadMetadataCount, 3);
  assert.equal(workspace.projects[0]?.activities[0]?.processingJobCount, 0);
});

test("organization update keeps top-level fields synchronized with organization settings", async () => {
  let capturedUpdateInput:
    Parameters<OrganizationRepository["update"]>[1] | undefined;

  const organizationRepository = {
    findById: async () => ({
      id: "organization-1",
      name: "Existing Org",
      mission: "Existing mission",
      logoUrl: null,
      settings: {
        ...createOrganizationSettings({
          organizationName: "Existing Org",
          mission: "Existing mission",
        }),
        legalForm: "Association",
        country: "Germany",
      },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    nameExists: async () => false,
    update: async (
      _organizationId: string,
      input: Parameters<OrganizationRepository["update"]>[1],
    ) => {
      capturedUpdateInput = input;
      return {
        id: "organization-1",
        name: input.name,
        mission: input.mission,
        logoUrl: null,
        settings: input.settings,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    },
    findMembership: async () => ({
      id: "membership-1",
      userId: "user-1",
      organizationId: "organization-1",
      role: "ORGANIZATION_ADMIN",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  } as unknown as OrganizationRepository;

  const organizationService = new OrganizationService(
    organizationRepository,
    {} as FileStorageService,
    {} as ProjectRepository,
    {} as ActivityRepository,
    {} as UploadMetadataRepository,
    {} as TransactionManager,
    {
      canManageOrganization: async () => undefined,
    } as unknown as AuthorizationService,
    {} as UserRepository,
  );

  const updatedOrganization = await organizationService.update(
    "user-1",
    "organization-1",
    {
      settings: {
        organizationName: "Updated Org",
        mission: "Updated mission",
        activityAreas: ["Education", "Democracy"],
        isRecognizedNonProfit: true,
      },
    },
  );

  assert.equal(capturedUpdateInput?.name, "Updated Org");
  assert.equal(capturedUpdateInput?.mission, "Updated mission");
  assert.equal(capturedUpdateInput?.settings.organizationName, "Updated Org");
  assert.equal(capturedUpdateInput?.settings.mission, "Updated mission");
  assert.deepEqual(capturedUpdateInput?.settings.activityAreas, [
    "Education",
    "Democracy",
  ]);
  assert.equal(capturedUpdateInput?.settings.legalForm, "Association");
  assert.equal(capturedUpdateInput?.settings.country, "Germany");
  assert.equal(updatedOrganization.name, "Updated Org");
  assert.equal(updatedOrganization.mission, "Updated mission");
  assert.equal(updatedOrganization.settings.isRecognizedNonProfit, true);
});
