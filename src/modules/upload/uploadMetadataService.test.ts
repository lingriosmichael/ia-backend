import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityService } from "../activity/activityService.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProjectDerivedStateInvalidationService } from "../analytics/projectDerivedStateInvalidationService.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { UserRepository } from "../user/userRepository.js";
import type { UploadMetadataRepository } from "./uploadMetadataRepository.js";
import { UploadMetadataService } from "./uploadMetadataService.js";

test("upload delete clears acknowledgment and invalidates project derived state when deleting acknowledged evidence", async () => {
  const calls: string[] = [];

  const uploadMetadataRepository = {
    findById: async () => ({
      id: "upload-1",
      activityId: "activity-1",
      projectId: "project-1",
      storageKey: "uploads/evidence.csv",
      originalFileDeletedAt: null,
    }),
    deleteById: async () => {
      calls.push("deleteUpload");
      return null;
    },
  } as unknown as UploadMetadataRepository;

  const activityRepository = {
    findById: async () => ({
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
      interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
      interpretationAcknowledgedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    update: async (_activityId: string, input: Record<string, unknown>) => {
      calls.push("clearAcknowledgment");
      assert.equal(input.interpretationAcknowledgedAt, null);
      assert.equal(input.interpretationAcknowledgedById, null);
      return {
        id: "activity-1",
        projectId: "project-1",
      };
    },
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditProject: async () => ({
      project: { id: "project-1" },
    }),
  } as unknown as AuthorizationService;

  const processingJobRepository = {
    findActiveByUploadMetadataId: async () => null,
    deleteByUploadMetadataId: async () => {
      calls.push("deleteJobs");
    },
  } as unknown as ProcessingJobRepository;

  const processingResourceCleanupService = {
    deleteByUploadMetadataId: async () => {
      calls.push("cleanupProcessing");
    },
  } as unknown as ProcessingResourceCleanupService;

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

  const service = new UploadMetadataService(
    uploadMetadataRepository,
    {} as ActivityService,
    authorizationService,
    {
      deleteStoredFiles: async () => {
        calls.push("deleteStoredFiles");
      },
    } as never,
    {} as UserRepository,
    transactionManager,
    activityRepository,
    processingJobRepository,
    processingResourceCleanupService,
    projectDerivedStateInvalidationService,
  );

  const deleted = await service.delete("user-1", "upload-1");

  assert.equal(deleted.id, "upload-1");
  assert.deepEqual(calls.slice(0, 3), [
    "beginTransaction",
    "clearAcknowledgment",
    "invalidate:project-1",
  ]);
  assert.ok(calls.includes("cleanupProcessing"));
  assert.ok(calls.includes("deleteJobs"));
  assert.ok(calls.includes("deleteUpload"));
  assert.ok(calls.includes("deleteStoredFiles"));
  assert.ok(calls.includes("commitTransaction"));
});

test("upload delete does not remove stored files when transactional cleanup fails", async () => {
  let deletedFiles = false;

  const service = new UploadMetadataService(
    {
      findById: async () => ({
        id: "upload-1",
        activityId: null,
        projectId: "project-1",
        storageKey: "uploads/evidence.csv",
        originalFileDeletedAt: null,
      }),
      deleteById: async () => null,
    } as unknown as UploadMetadataRepository,
    {} as ActivityService,
    {
      canEditProject: async () => ({
        project: { id: "project-1" },
      }),
    } as unknown as AuthorizationService,
    {
      deleteStoredFiles: async () => {
        deletedFiles = true;
      },
    } as never,
    {} as UserRepository,
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ActivityRepository,
    {
      findActiveByUploadMetadataId: async () => null,
      deleteByUploadMetadataId: async () => 0,
    } as unknown as ProcessingJobRepository,
    {
      deleteByUploadMetadataId: async () => {
        throw new Error("cleanup failed");
      },
    } as unknown as ProcessingResourceCleanupService,
    {
      invalidateProject: async () => undefined,
    } as unknown as ProjectDerivedStateInvalidationService,
  );

  await assert.rejects(service.delete("user-1", "upload-1"), /cleanup failed/);
  assert.equal(deletedFiles, false);
});

test("upload delete still succeeds when best-effort stored file cleanup fails", async () => {
  const service = new UploadMetadataService(
    {
      findById: async () => ({
        id: "upload-1",
        activityId: null,
        projectId: "project-1",
        storageKey: "uploads/evidence.csv",
        originalFileDeletedAt: null,
      }),
      deleteById: async () => null,
    } as unknown as UploadMetadataRepository,
    {} as ActivityService,
    {
      canEditProject: async () => ({
        project: { id: "project-1" },
      }),
    } as unknown as AuthorizationService,
    {
      deleteStoredFiles: async () => {
        throw new Error("filesystem unavailable");
      },
    } as never,
    {} as UserRepository,
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ActivityRepository,
    {
      findActiveByUploadMetadataId: async () => null,
      deleteByUploadMetadataId: async () => 0,
    } as unknown as ProcessingJobRepository,
    {
      deleteByUploadMetadataId: async () => 0,
    } as unknown as ProcessingResourceCleanupService,
    {
      invalidateProject: async () => undefined,
    } as unknown as ProjectDerivedStateInvalidationService,
  );

  const deleted = await service.delete("user-1", "upload-1");

  assert.equal(deleted.id, "upload-1");
});
