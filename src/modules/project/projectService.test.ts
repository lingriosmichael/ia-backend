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
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { UserRepository } from "../user/userRepository.js";
import type { ProjectUpdateInput } from "./projectPersistence.js";

function createOwnedProjectRecord(
  status: "planning" | "active" | "completed" = "planning",
  archivedFromStatus: "planning" | "active" | null = null,
) {
  return {
    id: "project-1",
    organizationId: "organization-1",
    ownerId: "user-1",
    name: "Mentoring Programme 2026",
    projectGoal: null,
    initialSituation: null,
    startMonth: "012026",
    endMonth: "122026",
    fundingProgram: null,
    fundingOrganization: null,
    targetGroups: [],
    overarchingTargetGroup: null,
    intendedChanges: [],
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
    status,
    archivedFromStatus,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

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
      canManageProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: createOwnedProjectRecord(),
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
      runInTransaction: async <T>(operation: (session: null) => Promise<T>) =>
        operation(null),
    } as unknown as TransactionManager;
    const processingJobRepository = {} as ProcessingJobRepository;
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
      processingJobRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
      { error: () => undefined } as never,
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
    const calls: string[] = [];
    let deletedStorageKeys: string[] = [];

    const projectRepository = {
      findDeleteContext: async () => ({
        id: "project-1",
        name: "Mentoring Programme 2026",
        organizationId: "organization-1",
      }),
      delete: async () => {
        calls.push("deleteProject");
        return {
          id: "project-1",
          organizationId: "organization-1",
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canManageProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: createOwnedProjectRecord(),
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
        calls.push("deleteUploads");
        return 2;
      },
    } as unknown as UploadMetadataRepository;
    const activityRepository = {
      deleteByProject: async () => {
        calls.push("deleteActivities");
        return 2;
      },
    } as unknown as ActivityRepository;

    const transactionManager = {
      runInTransaction: async <T>(operation: (session: null) => Promise<T>) => {
        calls.push("beginTransaction");
        const result = await operation(null);
        calls.push("commitTransaction");
        return result;
      },
    } as unknown as TransactionManager;
    const processingJobRepository = {
      deleteByProject: async () => {
        calls.push("deleteJobs");
        return 2;
      },
    } as unknown as ProcessingJobRepository;
    const userRepository = {} as UserRepository;
    const processingResourceCleanupService = {
      deleteByProjectId: async () => {
        calls.push("cleanupProcessing");
      },
    } as unknown as ProcessingResourceCleanupService;

    const projectService = new ProjectService(
      projectRepository,
      authorizationService,
      fileStorageService,
      activityRepository,
      uploadMetadataRepository,
      processingJobRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
      { error: () => undefined } as never,
    );

    const deletedProject = await projectService.delete("user-1", "project-1", {
      projectName: "Mentoring Programme 2026",
    });

    assert.deepEqual(deletedProject, {
      id: "project-1",
      organizationId: "organization-1",
    });
    assert.deepEqual(calls, [
      "beginTransaction",
      "cleanupProcessing",
      "deleteJobs",
      "deleteUploads",
      "deleteActivities",
      "deleteProject",
      "commitTransaction",
    ]);
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
      canManageProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: createOwnedProjectRecord(),
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
    const activityRepository = {
      deleteByProject: async () => 1,
    } as unknown as ActivityRepository;

    const transactionManager = {
      runInTransaction: async <T>(operation: (session: null) => Promise<T>) =>
        operation(null),
    } as unknown as TransactionManager;
    const processingJobRepository = {
      deleteByProject: async () => 0,
    } as unknown as ProcessingJobRepository;
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
      processingJobRepository,
      transactionManager,
      userRepository,
      processingResourceCleanupService,
      {} as unknown as OrganizationRepository,
      { error: () => undefined } as never,
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
  "project archiving stores the previous status when no active processing is running",
  { concurrency: false },
  async () => {
    let receivedUpdate: ProjectUpdateInput | undefined;

    const projectRepository = {
      update: async (_projectId: string, input: ProjectUpdateInput) => {
        receivedUpdate = input;
        return {
          ...createOwnedProjectRecord(
            "completed",
            input.archivedFromStatus ?? null,
          ),
          status: input.status ?? "completed",
          archivedFromStatus: input.archivedFromStatus ?? null,
          updatedAt: new Date("2026-01-03T00:00:00.000Z"),
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canManageProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: createOwnedProjectRecord("planning"),
      }),
      assertProjectIsOperational: () => undefined,
    } as unknown as AuthorizationService;

    const processingJobRepository = {
      countByProjectStatuses: async () => 0,
    } as unknown as ProcessingJobRepository;
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

    const service = new ProjectService(
      projectRepository,
      authorizationService,
      {} as FileStorageService,
      {} as ActivityRepository,
      {} as UploadMetadataRepository,
      processingJobRepository,
      {} as TransactionManager,
      userRepository,
      {} as ProcessingResourceCleanupService,
      {} as OrganizationRepository,
      { error: () => undefined } as never,
    );

    const updated = await service.update("user-1", "project-1", {
      status: "completed",
    });

    assert.deepEqual(receivedUpdate, {
      name: undefined,
      initialSituation: undefined,
      startMonth: undefined,
      endMonth: undefined,
      fundingProgram: undefined,
      fundingOrganization: undefined,
      targetGroups: undefined,
      overarchingTargetGroup: undefined,
      intendedChanges: undefined,
      areaOfOperation: undefined,
      partnerships: undefined,
      sdgs: undefined,
      impactModel: undefined,
      successIndicators: undefined,
      status: "completed",
      archivedFromStatus: "planning",
    });
    assert.equal(updated.status, "completed");
  },
);

test(
  "project reactivation restores the archived previous status",
  { concurrency: false },
  async () => {
    let receivedUpdate: ProjectUpdateInput | undefined;

    const projectRepository = {
      update: async (_projectId: string, input: ProjectUpdateInput) => {
        receivedUpdate = input;
        return {
          ...createOwnedProjectRecord(input.status ?? "planning", null),
          status: input.status ?? "planning",
          archivedFromStatus: input.archivedFromStatus ?? null,
          updatedAt: new Date("2026-01-03T00:00:00.000Z"),
        };
      },
    } as unknown as ProjectRepository;

    const authorizationService = {
      canManageProject: async () => ({
        membership: {
          id: "membership-1",
          userId: "user-1",
          organizationId: "organization-1",
          role: "PROJECT_MANAGER",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: createOwnedProjectRecord("completed", "planning"),
      }),
    } as unknown as AuthorizationService;

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

    const service = new ProjectService(
      projectRepository,
      authorizationService,
      {} as FileStorageService,
      {} as ActivityRepository,
      {} as UploadMetadataRepository,
      {} as ProcessingJobRepository,
      {} as TransactionManager,
      userRepository,
      {} as ProcessingResourceCleanupService,
      {} as OrganizationRepository,
      { error: () => undefined } as never,
    );

    const updated = await service.update("user-1", "project-1", {
      status: "active",
    });

    assert.deepEqual(receivedUpdate, {
      name: undefined,
      initialSituation: undefined,
      startMonth: undefined,
      endMonth: undefined,
      fundingProgram: undefined,
      fundingOrganization: undefined,
      targetGroups: undefined,
      overarchingTargetGroup: undefined,
      intendedChanges: undefined,
      areaOfOperation: undefined,
      partnerships: undefined,
      sdgs: undefined,
      impactModel: undefined,
      successIndicators: undefined,
      status: "planning",
      archivedFromStatus: null,
    });
    assert.equal(updated.status, "planning");
  },
);

test(
  "archived projects reject non-status edits and archiving is blocked while processing is active",
  { concurrency: false },
  async () => {
    let updateCalled = false;

    const projectRepository = {
      update: async () => {
        updateCalled = true;
        return createOwnedProjectRecord();
      },
    } as unknown as ProjectRepository;

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

    const archivedService = new ProjectService(
      projectRepository,
      {
        canManageProject: async () => ({
          membership: {
            id: "membership-1",
            userId: "user-1",
            organizationId: "organization-1",
            role: "PROJECT_MANAGER",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          project: createOwnedProjectRecord("completed", "active"),
        }),
        assertProjectIsOperational: () => {
          throw new AppError(
            "Archived projects are read-only. Reactivate the project to make changes.",
            409,
            "project_archived_read_only",
          );
        },
      } as unknown as AuthorizationService,
      {} as FileStorageService,
      {} as ActivityRepository,
      {} as UploadMetadataRepository,
      {} as ProcessingJobRepository,
      {} as TransactionManager,
      userRepository,
      {} as ProcessingResourceCleanupService,
      {} as OrganizationRepository,
      { error: () => undefined } as never,
    );

    await assert.rejects(
      archivedService.update("user-1", "project-1", {
        name: "Updated name",
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "project_archived_read_only",
    );

    const archivingBlockedService = new ProjectService(
      projectRepository,
      {
        canManageProject: async () => ({
          membership: {
            id: "membership-1",
            userId: "user-1",
            organizationId: "organization-1",
            role: "PROJECT_MANAGER",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          project: createOwnedProjectRecord("active"),
        }),
        assertProjectIsOperational: () => undefined,
      } as unknown as AuthorizationService,
      {} as FileStorageService,
      {} as ActivityRepository,
      {} as UploadMetadataRepository,
      {
        countByProjectStatuses: async () => 1,
      } as unknown as ProcessingJobRepository,
      {} as TransactionManager,
      userRepository,
      {} as ProcessingResourceCleanupService,
      {} as OrganizationRepository,
      { error: () => undefined } as never,
    );

    await assert.rejects(
      archivingBlockedService.update("user-1", "project-1", {
        status: "completed",
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "project_processing_in_progress",
    );

    assert.equal(updateCalled, false);
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
          startDate: null,
          endDate: null,
          objectives: null,
          successIndicators: null,
          targetAudience: null,
          interpretationAcknowledgedAt: new Date("2026-01-10T12:00:00.000Z"),
          interpretationAcknowledgedById: "user-1",
          status: "active",
          createdAt: new Date("2026-01-05T00:00:00.000Z"),
          updatedAt: new Date("2026-01-06T00:00:00.000Z"),
        },
      ],
      ensureSystemActivity: async (input: {
        projectId: string;
        systemType: "baseline" | "impact_measurement";
        name: string;
      }) => ({
        id: `system-${input.systemType}`,
        projectId: input.projectId,
        systemType: input.systemType,
        name: input.name,
        description: null,
        activityType: null,
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: null,
        output: null,
        concernTaggingInstruction: null,
        status: "active",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      }),
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
    const processingJobRepository = {
      listRecentByProject: async () => [
        {
          id: "job-2",
          activityId: "activity-1",
          jobType: "dataset_interpretation",
          status: "completed",
          createdAt: new Date("2026-01-10T00:00:00.000Z"),
          updatedAt: new Date("2026-01-11T00:00:00.000Z"),
          completedAt: new Date("2026-01-11T00:00:00.000Z"),
        },
        {
          id: "job-1",
          activityId: "activity-1",
          jobType: "evidence_processing",
          status: "failed",
          createdAt: new Date("2026-01-09T00:00:00.000Z"),
          updatedAt: new Date("2026-01-09T12:00:00.000Z"),
          completedAt: new Date("2026-01-09T12:00:00.000Z"),
        },
      ],
      countByProjectTypeStatuses: async () => 1,
      countByProjectStatuses: async () => 1,
    } as unknown as ProcessingJobRepository;

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
      processingJobRepository,
      {} as TransactionManager,
      userRepository,
      {
        deleteByProjectId: async () => undefined,
      } as unknown as ProcessingResourceCleanupService,
      {} as unknown as OrganizationRepository,
      { error: () => undefined } as never,
    );

    const overview = await projectService.getOverview("user-1", "project-1");

    const activity = overview.activities.find(
      (item) => item.id === "activity-1",
    );

    assert.equal(activity?.uploadMetadataCount, 2);
    assert.equal(activity?.processingJobCount, 0);
    assert.equal(overview.metrics.insightCount, 1);
    assert.equal(overview.metrics.pendingInsightCount, 1);
    assert.equal(overview.metrics.failedJobCount, 1);
    assert.deepEqual(
      overview.recentActivity.map((item) => item.type),
      [
        "insight_generated",
        "job_failed",
        "dataset_uploaded",
        "dataset_uploaded",
        "activity_created",
      ],
    );
  },
);
