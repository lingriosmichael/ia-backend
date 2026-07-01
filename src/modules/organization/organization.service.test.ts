import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityRepository } from "../activity/activity.repository.js";
import type { ResultRepository } from "../ai/artifact/result.repository.js";
import type { ProcessingJobRepository } from "../ai/execution/processing-job.repository.js";
import type { ProjectRepository } from "../project/project.repository.js";
import type { TransactionManager } from "../../shared/database/transaction-manager.js";
import { FileStorageService } from "../upload/file-storage.service.js";
import type { UploadMetadataRepository } from "../upload/upload-metadata.repository.js";
import type { OrganizationRepository } from "./organization.repository.js";
import { OrganizationService } from "./organization.service.js";

test("organization workspace enriches activity upload counts from the upload repository", async () => {
  const organizationRepository = {
    findWorkspaceForUser: async () => ({
      id: "organization-1",
      name: "Example Org",
      slug: "example-org",
      description: null,
      logoPath: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      memberships: [{ role: "owner" }],
    }),
  } as unknown as OrganizationRepository;

  const projectRepository = {
    listByOrganization: async () => [
      {
        id: "project-1",
        organizationId: "organization-1",
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

  const organizationService = new OrganizationService(
    organizationRepository,
    fileStorageService,
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    processingJobRepository,
    resultRepository,
    transactionManager,
  );

  const workspace = await organizationService.getWorkspace(
    "user-1",
    "organization-1",
  );

  assert.equal(workspace.projects[0]?.activities[0]?.uploadMetadataCount, 3);
  assert.equal(workspace.projects[0]?.activities[0]?.processingJobCount, 2);
  assert.equal(workspace.projects[0]?.activities[0]?.resultCount, 1);
});
