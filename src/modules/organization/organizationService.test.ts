import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ResultRepository } from "../ai/artifact/resultRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import type { OrganizationRepository } from "./organizationRepository.js";
import { OrganizationService } from "./organizationService.js";

test("organization workspace enriches activity upload counts from the upload repository", async () => {
  const organizationRepository = {
    findWorkspaceForUser: async () => ({
      id: "organization-1",
      name: "Example Org",
      mission: null,
      logoUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      memberships: [{ role: "ORGANIZATION_ADMIN" }],
    }),
  } as unknown as OrganizationRepository;

  const projectRepository = {
    listByOrganization: async () => [
      {
        id: "project-1",
        organizationId: "organization-1",
        ownerId: "user-1",
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
  const processingJobRepository = {
    countByActivityIds: async () => ({
      "activity-1": 2,
    }),
  } as unknown as ProcessingJobRepository;
  const resultRepository = {
    countByActivityIds: async () => ({
      "activity-1": 1,
    }),
  } as unknown as ResultRepository;

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
    processingJobRepository,
    resultRepository,
    transactionManager,
    authorizationService,
    userRepository,
  );

  const workspace = await organizationService.getWorkspace(
    "user-1",
    "organization-1",
  );

  assert.equal(workspace.projects[0]?.activities[0]?.uploadMetadataCount, 3);
  assert.equal(workspace.projects[0]?.activities[0]?.processingJobCount, 2);
  assert.equal(workspace.projects[0]?.activities[0]?.resultCount, 1);
});
