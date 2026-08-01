import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { ProjectDerivedStateInvalidationService } from "../analytics/projectDerivedStateInvalidationService.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { ActivityRepository } from "./activityRepository.js";
import { ActivityService } from "./activityService.js";

test("activity getById authorizes access through the project service", async () => {
  let authorizedProjectId: string | null = null;

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      description: null,
      startDate: null,
      endDate: null,
      targetAudience: null,
      objectives: null,
      output: null,
      outcome: null,
      status: "active",
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
        activity: {
          id: "activity-1",
          projectId: "project-1",
          name: "Activity One",
          description: null,
          startDate: null,
          endDate: null,
          targetAudience: null,
          objectives: null,
          output: null,
          outcome: null,
          status: "active",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      };
    },
  } as unknown as AuthorizationService;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    {} as UploadMetadataRepository,
    new FileStorageService("/tmp"),
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    {} as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const activity = await activityService.getById("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
  assert.equal(authorizedProjectId, "project-1");
});

test("activity create trims text fields and collapses whitespace-only optional text to null", async () => {
  const captured: { input: Record<string, unknown> | null } = { input: null };

  const activityRepository = {
    create: async (input: Record<string, unknown>) => {
      captured.input = input;
      return {
        id: "activity-1",
        projectId: "project-1",
        name: input.name,
        description: input.description,
        startDate: null,
        endDate: null,
        targetAudience: input.targetAudience,
        objectives: input.objectives,
        output: input.output,
        outcome: input.outcome,
        status: "active",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    },
  } as unknown as ActivityRepository;

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
        ownerName: "Owner",
        name: "Project One",
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
        status: "active",
        archivedFromStatus: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  } as unknown as AuthorizationService;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    {} as UploadMetadataRepository,
    new FileStorageService("/tmp"),
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    {} as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  await activityService.create("user-1", "project-1", {
    name: "  My Activity  ",
    output: "   ",
    outcome: "  Real outcome text  ",
  });

  assert.equal(captured.input?.name, "My Activity");
  assert.equal(captured.input?.output, null);
  assert.equal(captured.input?.outcome, "Real outcome text");
});

test("activity update invalidates AI knowledge state when output/outcome actually change", async () => {
  const calls: string[] = [];
  const captured: { input: Record<string, unknown> | null } = { input: null };

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      description: null,
      startDate: null,
      endDate: null,
      targetAudience: null,
      objectives: null,
      output: "old output",
      outcome: "old outcome",
      status: "active",
      interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
      interpretationAcknowledgedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    update: async (_activityId: string, input: Record<string, unknown>) => {
      captured.input = input;
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity One",
        description: null,
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: null,
        output: "new output",
        outcome: "old outcome",
        status: "active",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      };
    },
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: { id: "project-1", ownerId: "user-1" },
    }),
  } as unknown as AuthorizationService;

  const projectDerivedStateInvalidationService = {
    invalidateProject: async (projectId: string) => {
      calls.push(`invalidate:${projectId}`);
    },
  } as unknown as ProjectDerivedStateInvalidationService;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    {} as UploadMetadataRepository,
    new FileStorageService("/tmp"),
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    projectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  await activityService.update("user-1", "activity-1", {
    output: "new output",
  });

  assert.equal(captured.input?.interpretationAcknowledgedAt, null);
  assert.equal(captured.input?.interpretationAcknowledgedById, null);
  assert.equal(captured.input?.aiKnowledgeSnapshot, null);
  assert.deepEqual(calls, ["invalidate:project-1"]);
});

test("activity update does not invalidate AI knowledge state when the only change is whitespace padding", async () => {
  const calls: string[] = [];
  const captured: { input: Record<string, unknown> | null } = { input: null };

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      description: null,
      startDate: null,
      endDate: null,
      targetAudience: null,
      objectives: null,
      output: "Same output",
      outcome: null,
      status: "active",
      interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
      interpretationAcknowledgedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    update: async (_activityId: string, input: Record<string, unknown>) => {
      captured.input = input;
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity One",
        description: null,
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: null,
        output: "Same output",
        outcome: null,
        status: "active",
        interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
        interpretationAcknowledgedById: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      };
    },
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: { id: "project-1", ownerId: "user-1" },
    }),
  } as unknown as AuthorizationService;

  const projectDerivedStateInvalidationService = {
    invalidateProject: async (projectId: string) => {
      calls.push(`invalidate:${projectId}`);
    },
  } as unknown as ProjectDerivedStateInvalidationService;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    {} as UploadMetadataRepository,
    new FileStorageService("/tmp"),
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    projectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  await activityService.update("user-1", "activity-1", {
    output: "  Same output  ",
  });

  assert.equal(captured.input?.interpretationAcknowledgedAt, undefined);
  assert.equal(captured.input?.interpretationAcknowledgedById, undefined);
  assert.equal(captured.input?.aiKnowledgeSnapshot, undefined);
  assert.deepEqual(calls, []);
});

test("activity delete clears acknowledgment and invalidates project derived state before deleting records", async () => {
  const calls: string[] = [];

  const activityRepository = {
    update: async (_activityId: string, input: Record<string, unknown>) => {
      calls.push("clearAcknowledgment");
      assert.equal(input.interpretationAcknowledgedAt, null);
      assert.equal(input.interpretationAcknowledgedById, null);
      return {
        id: "activity-1",
        projectId: "project-1",
      };
    },
    deleteById: async () => {
      calls.push("deleteActivity");
      return {
        id: "activity-1",
        projectId: "project-1",
      };
    },
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      description: null,
      startDate: null,
      endDate: null,
      targetAudience: null,
      objectives: null,
      output: null,
      outcome: null,
      status: "active",
      interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
      interpretationAcknowledgedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: { id: "project-1" },
      activity: {
        id: "activity-1",
        projectId: "project-1",
        interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
        interpretationAcknowledgedById: "user-1",
      },
    }),
  } as unknown as AuthorizationService;

  const uploadMetadataRepository = {
    listStorageKeysByActivity: async () => [],
    deleteByActivity: async () => {
      calls.push("deleteUploads");
    },
  } as unknown as UploadMetadataRepository;

  const processingResourceCleanupService = {
    deleteByActivityId: async () => {
      calls.push("cleanupProcessing");
    },
  } as unknown as ProcessingResourceCleanupService;

  const processingJobRepository = {
    deleteByActivity: async () => {
      calls.push("deleteJobs");
    },
  } as unknown as ProcessingJobRepository;

  const projectDerivedStateInvalidationService = {
    invalidateProject: async (projectId: string) => {
      calls.push(`invalidate:${projectId}`);
    },
  } as unknown as ProjectDerivedStateInvalidationService;

  const transactionManager = {
    runInTransaction: async (operation) => {
      calls.push("beginTransaction");
      const result = await operation(null);
      calls.push("commitTransaction");
      return result;
    },
  } as TransactionManager;

  const activityService = new ActivityService(
    activityRepository,
    authorizationService,
    uploadMetadataRepository,
    { deleteStoredFiles: async () => {} } as unknown as FileStorageService,
    transactionManager,
    processingJobRepository,
    processingResourceCleanupService,
    projectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  await activityService.delete("user-1", "activity-1");

  assert.deepEqual(calls.slice(0, 3), [
    "beginTransaction",
    "clearAcknowledgment",
    "invalidate:project-1",
  ]);
  assert.ok(calls.includes("cleanupProcessing"));
  assert.ok(calls.includes("deleteJobs"));
  assert.ok(calls.includes("deleteUploads"));
  assert.ok(calls.includes("deleteActivity"));
  assert.ok(calls.includes("commitTransaction"));
});

test("activity delete does not delete stored files when transactional cleanup fails", async () => {
  let deletedFiles = false;

  const activityService = new ActivityService(
    {
      deleteById: async () => null,
    } as unknown as ActivityRepository,
    {
      canEditActivity: async () => ({
        project: { id: "project-1" },
        activity: {
          id: "activity-1",
          projectId: "project-1",
          interpretationAcknowledgedAt: null,
          interpretationAcknowledgedById: null,
        },
      }),
    } as unknown as AuthorizationService,
    {
      listStorageKeysByActivity: async () => ["uploads/evidence.csv"],
      deleteByActivity: async () => 0,
    } as unknown as UploadMetadataRepository,
    {
      deleteStoredFiles: async () => {
        deletedFiles = true;
      },
    } as unknown as FileStorageService,
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {
      deleteByActivity: async () => 0,
    } as unknown as ProcessingJobRepository,
    {
      deleteByActivityId: async () => {
        throw new Error("cleanup failed");
      },
    } as unknown as ProcessingResourceCleanupService,
    {
      invalidateProject: async () => undefined,
    } as unknown as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  await assert.rejects(
    activityService.delete("user-1", "activity-1"),
    /cleanup failed/,
  );
  assert.equal(deletedFiles, false);
});

test("activity delete still succeeds when best-effort stored file cleanup fails", async () => {
  const activityService = new ActivityService(
    {
      deleteById: async () => null,
    } as unknown as ActivityRepository,
    {
      canEditActivity: async () => ({
        project: { id: "project-1" },
        activity: {
          id: "activity-1",
          projectId: "project-1",
          interpretationAcknowledgedAt: null,
          interpretationAcknowledgedById: null,
        },
      }),
    } as unknown as AuthorizationService,
    {
      listStorageKeysByActivity: async () => ["uploads/evidence.csv"],
      deleteByActivity: async () => 0,
    } as unknown as UploadMetadataRepository,
    {
      deleteStoredFiles: async () => {
        throw new Error("filesystem unavailable");
      },
    } as unknown as FileStorageService,
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {
      deleteByActivity: async () => 0,
    } as unknown as ProcessingJobRepository,
    {
      deleteByActivityId: async () => 0,
    } as unknown as ProcessingResourceCleanupService,
    {
      invalidateProject: async () => undefined,
    } as unknown as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const result = await activityService.delete("user-1", "activity-1");

  assert.equal(result.id, "activity-1");
});
