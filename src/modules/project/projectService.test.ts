import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { ProjectRepository } from "./projectRepository.js";
import { ProjectService } from "./projectService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ResultRepository } from "../ai/artifact/resultRepository.js";
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
    const processingJobRepository = {} as ProcessingJobRepository;
    const resultRepository = {} as ResultRepository;

    const transactionManager = {
      runInTransaction: async <T>(
        operation: (session: undefined) => Promise<T>,
      ) => operation(undefined),
    } as unknown as TransactionManager;
    const userRepository = {} as UserRepository;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      processingJobRepository,
      resultRepository,
      transactionManager,
      userRepository,
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
    const processingJobRepository = {} as ProcessingJobRepository;
    const resultRepository = {} as ResultRepository;

    const transactionManager = {
      runInTransaction: async <T>(
        operation: (session: undefined) => Promise<T>,
      ) => operation(undefined),
    } as unknown as TransactionManager;
    const userRepository = {} as UserRepository;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      processingJobRepository,
      resultRepository,
      transactionManager,
      userRepository,
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
