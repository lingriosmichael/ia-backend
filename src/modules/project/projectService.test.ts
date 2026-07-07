import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { ProjectRepository } from "./projectRepository.js";
import { ProjectService } from "./projectService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { UserRepository } from "../user/userRepository.js";

test(
  "project deletion rejects a mismatched confirmation name",
  { concurrency: false },
  async () => {
    let deleteCalled = false;
    let deletedStorageKeys: string[] = [];
    let deletedUploadRecords = 0;

    const projectRepository = {
      findDeleteContext: async () => ({
        id: "project-1",
        name: "Mentoring Programme 2026",
        organizationId: "organization-1",
      }),
      delete: async () => {
        deleteCalled = true;
        return {
          id: "project-1",
          organizationId: "organization-1",
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canEditProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: {
          id: "project-1",
          organizationId: "organization-1",
          ownerId: "user-1",
          name: "Mentoring Programme 2026",
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
        },
      }),
    } as unknown as AuthorizationService;

    const fileStorageService = {
      deleteStoredFiles: async (storageKeys: string[]) => {
        deletedStorageKeys = storageKeys;
      },
    } as unknown as FileStorageService;

    const uploadMetadataRepository = {
      listStorageKeysByProject: async () => ["activity-1/dataset.csv"],
      deleteByProject: async () => {
        deletedUploadRecords += 1;
        return 1;
      },
    } as unknown as UploadMetadataRepository;
    const activityRepository = {} as ActivityRepository;

    const transactionManager = {
      runInTransaction: async <T>(
        operation: (session: undefined) => Promise<T>,
      ) => operation(undefined),
    } as unknown as TransactionManager;
    const userRepository = {} as UserRepository;
    const processingResourceCleanupService = {
      deleteByProjectId: async () => undefined,
    } as unknown as ProcessingResourceCleanupService;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
    );

    await assert.rejects(
      projectService.delete("user-1", "project-1", {
        projectName: "Wrong project",
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "project_name_confirmation_mismatch",
    );

    assert.equal(deleteCalled, false);
    assert.deepEqual(deletedStorageKeys, []);
    assert.equal(deletedUploadRecords, 0);
  },
);

test(
  "project deletion removes the project and stored upload files after confirmation",
  { concurrency: false },
  async () => {
    let deleteCallCount = 0;
    let deletedStorageKeys: string[] = [];
    let deletedUploadRecords = 0;

    const projectRepository = {
      findDeleteContext: async () => ({
        id: "project-1",
        name: "Mentoring Programme 2026",
        organizationId: "organization-1",
      }),
      delete: async () => {
        deleteCallCount += 1;
        return {
          id: "project-1",
          organizationId: "organization-1",
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canEditProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: {
          id: "project-1",
          organizationId: "organization-1",
          ownerId: "user-1",
          name: "Mentoring Programme 2026",
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
        },
      }),
    } as unknown as AuthorizationService;

    const fileStorageService = {
      deleteStoredFiles: async (storageKeys: string[]) => {
        deletedStorageKeys = storageKeys;
      },
    } as unknown as FileStorageService;

    const uploadMetadataRepository = {
      listStorageKeysByProject: async () => [
        "activity-1/dataset.csv",
        "activity-1/dataset.csv",
      ],
      deleteByProject: async () => {
        deletedUploadRecords += 1;
        return 2;
      },
    } as unknown as UploadMetadataRepository;
    const activityRepository = {} as ActivityRepository;

    const transactionManager = {
      runInTransaction: async <T>(
        operation: (session: undefined) => Promise<T>,
      ) => operation(undefined),
    } as unknown as TransactionManager;
    const userRepository = {} as UserRepository;
    const processingResourceCleanupService = {
      deleteByProjectId: async () => undefined,
    } as unknown as ProcessingResourceCleanupService;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
    );

    const deletedProject = await projectService.delete("user-1", "project-1", {
      projectName: "Mentoring Programme 2026",
    });

    assert.deepEqual(deletedProject, {
      id: "project-1",
      organizationId: "organization-1",
    });
    assert.equal(deleteCallCount, 1);
    assert.equal(deletedUploadRecords, 1);
    assert.deepEqual(deletedStorageKeys, [
      "activity-1/dataset.csv",
      "activity-1/dataset.csv",
    ]);
  },
);

test(
  "project deletion aborts and leaves the project intact if dependent cleanup fails",
  { concurrency: false },
  async () => {
    let projectDeleteCalled = false;
    let deletedStorageKeys: string[] | undefined;

    const projectRepository = {
      findDeleteContext: async () => ({
        id: "project-1",
        name: "Mentoring Programme 2026",
        organizationId: "organization-1",
      }),
      delete: async () => {
        projectDeleteCalled = true;
        return {
          id: "project-1",
          organizationId: "organization-1",
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canEditProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: {
          id: "project-1",
          organizationId: "organization-1",
          ownerId: "user-1",
          name: "Mentoring Programme 2026",
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
        },
      }),
    } as unknown as AuthorizationService;

    const fileStorageService = {
      deleteStoredFiles: async (storageKeys: string[]) => {
        deletedStorageKeys = storageKeys;
      },
    } as unknown as FileStorageService;

    const uploadMetadataRepository = {
      listStorageKeysByProject: async () => ["activity-1/dataset.csv"],
      deleteByProject: async () => 1,
    } as unknown as UploadMetadataRepository;
    const activityRepository = {} as ActivityRepository;

    const transactionManager = {
      runInTransaction: async <T>(
        operation: (session: undefined) => Promise<T>,
      ) => operation(undefined),
    } as unknown as TransactionManager;
    const userRepository = {} as UserRepository;
    const processingResourceCleanupService = {
      deleteByProjectId: async () => {
        throw new Error("Simulated processing cleanup failure.");
      },
    } as unknown as ProcessingResourceCleanupService;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
    );

    await assert.rejects(
      () =>
        projectService.delete("user-1", "project-1", {
          projectName: "Mentoring Programme 2026",
        }),
      /Simulated processing cleanup failure/,
    );

    assert.equal(
      projectDeleteCalled,
      false,
      "the project document must not be deleted when dependent cleanup fails",
    );
    assert.equal(
      deletedStorageKeys,
      undefined,
      "stored files must not be deleted when dependent cleanup fails",
    );
  },
);

test(
  "project overview only surfaces user-visible activity and evidence counts",
  { concurrency: false },
  async () => {
    const authorizationService = {
      canViewProject: async () => ({
        project: {
          id: "project-1",
          organizationId: "organization-1",
          ownerId: "user-1",
          name: "Mentoring Programme 2026",
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
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      }),
    } as unknown as AuthorizationService;

    const activityRepository = {
      listByProject: async () => [
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
      countByProject: async () => 2,
      countByActivityIds: async () => ({
        "activity-1": 2,
      }),
      listRecentByProject: async () => [
        {
          id: "upload-2",
          activityId: "activity-1",
          createdAt: new Date("2026-01-08T00:00:00.000Z"),
        },
        {
          id: "upload-1",
          activityId: "activity-1",
          createdAt: new Date("2026-01-07T00:00:00.000Z"),
        },
      ],
    } as unknown as UploadMetadataRepository;

    const userRepository = {
      findById: async () => ({
        id: "user-1",
        email: "owner@example.org",
        fullName: "Project Owner",
        passwordHash: "hash",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as unknown as UserRepository;

    const projectService = new ProjectService(
      {} as ProjectRepository,
      authorizationService,
      {} as FileStorageService,
      activityRepository,
      uploadMetadataRepository,
      {} as TransactionManager,
      userRepository,
      {
        deleteByProjectId: async () => undefined,
      } as unknown as ProcessingResourceCleanupService,
      {} as unknown as OrganizationRepository,
    );

    const overview = await projectService.getOverview("user-1", "project-1");

    assert.equal(overview.activities[0]?.uploadMetadataCount, 2);
    assert.equal(overview.activities[0]?.processingJobCount, 0);
    assert.equal(overview.activities[0]?.resultCount, 0);
    assert.equal(overview.metrics.insightCount, 0);
    assert.equal(overview.metrics.pendingInsightCount, 0);
    assert.equal(overview.metrics.failedJobCount, 0);
    assert.deepEqual(
      overview.recentActivity.map((item) => item.type),
      ["dataset_uploaded", "dataset_uploaded", "activity_created"],
    );
  },
);
