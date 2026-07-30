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

test("upload create clears acknowledgment and invalidates project derived state when new activity evidence is added", async () => {
  const calls: string[] = [];

  const uploadMetadataRepository = {
    create: async (input: Record<string, unknown>) => {
      calls.push("createUpload");
      return {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        logicalEvidenceId: "logical-1",
        versionNumber: 1,
        replacesUploadMetadataId: null,
        supersededAt: null,
        originalFileName: input.originalFileName,
        contentType: null,
        sizeBytes: null,
        storageKey: null,
        originalFileDeletedAt: null,
        status: "uploaded",
        uploadedById: "user-1",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      };
    },
  } as unknown as UploadMetadataRepository;

  const authorizationService = {
    canUploadToActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity One",
        description: null,
        startDate: null,
        endDate: null,
        objectives: null,
        output: null,
        outcome: null,
        targetAudience: null,
        status: "active",
        interpretationAcknowledgedAt: new Date("2026-01-03T00:00:00.000Z"),
        interpretationAcknowledgedById: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    }),
  } as unknown as AuthorizationService;

  const activityService = {
    getById: async () => ({
      id: "activity-1",
      projectId: "project-1",
    }),
  } as unknown as ActivityService;

  const activityRepository = {
    findById: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity One",
      description: null,
      startDate: null,
      endDate: null,
      objectives: null,
      output: null,
      outcome: null,
      targetAudience: null,
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

  const projectDerivedStateInvalidationService = {
    invalidateProject: async (projectId: string) => {
      calls.push(`invalidate:${projectId}`);
    },
  } as unknown as ProjectDerivedStateInvalidationService;

  const service = new UploadMetadataService(
    uploadMetadataRepository,
    activityService,
    authorizationService,
    {} as never,
    {
      findById: async () => ({ id: "user-1", fullName: "User One" }),
      findByIds: async () => [{ id: "user-1", fullName: "User One" }],
    } as unknown as UserRepository,
    {} as TransactionManager,
    activityRepository,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    projectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const created = await service.create("user-1", "project-1", {
    activityId: "activity-1",
    originalFileName: "new-evidence.csv",
  });

  assert.equal(created.activityId, "activity-1");
  assert.deepEqual(calls, [
    "createUpload",
    "clearAcknowledgment",
    "invalidate:project-1",
  ]);
});

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
      startDate: null,
      endDate: null,
      objectives: null,
      output: null,
      outcome: null,
      targetAudience: null,
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
    { error: () => undefined } as never,
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
    { error: () => undefined } as never,
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
    { error: () => undefined } as never,
  );

  const deleted = await service.delete("user-1", "upload-1");

  assert.equal(deleted.id, "upload-1");
});

test("createDerivedWorkbookSheetUpload falls back to the existing derived upload on duplicate-key races", async () => {
  let createAttempts = 0;

  const existingDerivedUpload = {
    id: "derived-upload-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    sourceWorkbookUploadMetadataId: "source-upload-1",
    derivedSheetName: "Sheet 1",
    derivedSheetIndex: 0,
    uploadedById: "user-1",
    logicalEvidenceId: "logical-derived-1",
    versionNumber: 1,
    replacesUploadMetadataId: null,
    supersededAt: null,
    originalFileName: "Sheet 1.csv",
    contentType: "text/csv",
    sizeBytes: 128,
    storageKey: "activity-1/sheet-1.csv",
    originalFileDeletedAt: null,
    status: "uploaded",
    createdAt: new Date("2026-07-30T10:00:00.000Z"),
    updatedAt: new Date("2026-07-30T10:00:00.000Z"),
  };

  const service = new UploadMetadataService(
    {
      findById: async () => ({
        id: "source-upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        sourceWorkbookUploadMetadataId: null,
        derivedSheetName: null,
        derivedSheetIndex: null,
        uploadedById: "user-1",
        logicalEvidenceId: "logical-source-1",
        versionNumber: 1,
        replacesUploadMetadataId: null,
        supersededAt: null,
        originalFileName: "Workbook.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 2048,
        storageKey: "activity-1/workbook.xlsx",
        originalFileDeletedAt: null,
        status: "uploaded",
        createdAt: new Date("2026-07-30T09:00:00.000Z"),
        updatedAt: new Date("2026-07-30T09:00:00.000Z"),
      }),
      findDerivedBySourceWorkbookAndSheetIndex: async () =>
        createAttempts === 0 ? null : existingDerivedUpload,
      create: async () => {
        createAttempts += 1;
        const error = Object.assign(new Error("duplicate key"), {
          code: 11000,
        });
        throw error;
      },
    } as unknown as UploadMetadataRepository,
    {} as ActivityService,
    {} as AuthorizationService,
    {} as never,
    {
      findById: async () => ({ id: "user-1", fullName: "User One" }),
      findByIds: async () => [{ id: "user-1", fullName: "User One" }],
    } as unknown as UserRepository,
    {
      runInTransaction: async (operation) => operation(null),
    } as TransactionManager,
    {} as ActivityRepository,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    {} as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const result = await service.createDerivedWorkbookSheetUpload({
    sourceWorkbookUploadMetadataId: "source-upload-1",
    triggeredById: "user-1",
    originalFileName: "Sheet 1.csv",
    contentType: "text/csv",
    sizeBytes: 128,
    storageKey: "activity-1/sheet-1.csv",
    derivedSheetName: "Sheet 1",
    derivedSheetIndex: 0,
  });

  assert.equal(result.created, false);
  assert.equal(result.upload.id, "derived-upload-1");
});

test("archiveAfterWorkbookSplit deletes the original workbook file and stamps originalFileDeletedAt", async () => {
  let deletedStorageKeys: string[] | undefined;
  let updateInput:
    Parameters<UploadMetadataRepository["update"]>[1] | undefined;

  const service = new UploadMetadataService(
    {
      findById: async () => ({
        id: "source-upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        sourceWorkbookUploadMetadataId: null,
        derivedSheetName: null,
        derivedSheetIndex: null,
        uploadedById: "user-1",
        logicalEvidenceId: "logical-source-1",
        versionNumber: 1,
        replacesUploadMetadataId: null,
        supersededAt: null,
        originalFileName: "Workbook.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 2048,
        storageKey: "activity-1/workbook.xlsx",
        originalFileDeletedAt: null,
        status: "uploaded",
        createdAt: new Date("2026-07-30T09:00:00.000Z"),
        updatedAt: new Date("2026-07-30T09:00:00.000Z"),
      }),
      update: async (
        _uploadMetadataId: string,
        input: Parameters<UploadMetadataRepository["update"]>[1],
      ) => {
        updateInput = input;
        return {
          id: "source-upload-1",
          organizationId: "org-1",
          projectId: "project-1",
          activityId: "activity-1",
          sourceWorkbookUploadMetadataId: null,
          derivedSheetName: null,
          derivedSheetIndex: null,
          uploadedById: "user-1",
          logicalEvidenceId: "logical-source-1",
          versionNumber: 1,
          replacesUploadMetadataId: null,
          supersededAt: null,
          originalFileName: "Workbook.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 2048,
          storageKey: "activity-1/workbook.xlsx",
          originalFileDeletedAt:
            input.originalFileDeletedAt instanceof Date
              ? input.originalFileDeletedAt
              : null,
          status: input.status ?? "archived",
          createdAt: new Date("2026-07-30T09:00:00.000Z"),
          updatedAt: new Date("2026-07-30T10:00:00.000Z"),
        };
      },
    } as unknown as UploadMetadataRepository,
    {} as ActivityService,
    {} as AuthorizationService,
    {
      deleteStoredFiles: async (storageKeys: string[]) => {
        deletedStorageKeys = storageKeys;
      },
    } as never,
    {
      findById: async () => ({ id: "user-1", fullName: "User One" }),
      findByIds: async () => [{ id: "user-1", fullName: "User One" }],
    } as unknown as UserRepository,
    {} as TransactionManager,
    {} as ActivityRepository,
    {} as ProcessingJobRepository,
    {} as ProcessingResourceCleanupService,
    {} as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const archived = await service.archiveAfterWorkbookSplit("source-upload-1");

  assert.deepEqual(deletedStorageKeys, ["activity-1/workbook.xlsx"]);
  assert.equal(archived.status, "archived");
  assert.ok(updateInput?.originalFileDeletedAt instanceof Date);
});

test("cleanupDerivedWorkbookSheetUploads removes derived uploads, jobs, processing artifacts, and files", async () => {
  const calls: string[] = [];
  let deletedStorageKeys: string[] | undefined;

  const derivedUploads = [
    {
      id: "derived-upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      sourceWorkbookUploadMetadataId: "source-upload-1",
      derivedSheetName: "Sheet 1",
      derivedSheetIndex: 0,
      uploadedById: "user-1",
      logicalEvidenceId: "logical-1",
      versionNumber: 1,
      replacesUploadMetadataId: null,
      supersededAt: null,
      originalFileName: "Sheet 1.csv",
      contentType: "text/csv",
      sizeBytes: 128,
      storageKey: "activity-1/sheet-1.csv",
      originalFileDeletedAt: null,
      status: "uploaded",
      createdAt: new Date("2026-07-30T10:00:00.000Z"),
      updatedAt: new Date("2026-07-30T10:00:00.000Z"),
    },
    {
      id: "derived-upload-2",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      sourceWorkbookUploadMetadataId: "source-upload-1",
      derivedSheetName: "Sheet 2",
      derivedSheetIndex: 1,
      uploadedById: "user-1",
      logicalEvidenceId: "logical-2",
      versionNumber: 1,
      replacesUploadMetadataId: null,
      supersededAt: null,
      originalFileName: "Sheet 2.csv",
      contentType: "text/csv",
      sizeBytes: 256,
      storageKey: "activity-1/sheet-2.csv",
      originalFileDeletedAt: null,
      status: "uploaded",
      createdAt: new Date("2026-07-30T10:01:00.000Z"),
      updatedAt: new Date("2026-07-30T10:01:00.000Z"),
    },
  ];

  const service = new UploadMetadataService(
    {
      listDerivedBySourceWorkbook: async () => derivedUploads,
      deleteById: async (uploadMetadataId: string) => {
        calls.push(`deleteUpload:${uploadMetadataId}`);
        return null;
      },
    } as unknown as UploadMetadataRepository,
    {} as ActivityService,
    {} as AuthorizationService,
    {
      deleteStoredFiles: async (storageKeys: string[]) => {
        deletedStorageKeys = storageKeys;
      },
    } as never,
    {
      findById: async () => ({ id: "user-1", fullName: "User One" }),
      findByIds: async () => [{ id: "user-1", fullName: "User One" }],
    } as unknown as UserRepository,
    {
      runInTransaction: async (operation) => {
        calls.push("beginTransaction");
        const result = await operation(null);
        calls.push("commitTransaction");
        return result;
      },
    } as TransactionManager,
    {
      findById: async () => ({
        id: "activity-1",
        projectId: "project-1",
        name: "Activity One",
        description: null,
        startDate: null,
        endDate: null,
        objectives: null,
        output: null,
        outcome: null,
        targetAudience: null,
        status: "active",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      update: async () => {
        calls.push("clearAcknowledgment");
        return {
          id: "activity-1",
          projectId: "project-1",
        };
      },
    } as unknown as ActivityRepository,
    {
      deleteByUploadMetadataId: async (uploadMetadataId: string) => {
        calls.push(`deleteJobs:${uploadMetadataId}`);
        return 1;
      },
    } as unknown as ProcessingJobRepository,
    {
      deleteByUploadMetadataId: async (uploadMetadataId: string) => {
        calls.push(`cleanupProcessing:${uploadMetadataId}`);
      },
    } as unknown as ProcessingResourceCleanupService,
    {
      invalidateProject: async (projectId: string) => {
        calls.push(`invalidate:${projectId}`);
      },
    } as unknown as ProjectDerivedStateInvalidationService,
    { error: () => undefined } as never,
  );

  const result =
    await service.cleanupDerivedWorkbookSheetUploads("source-upload-1");

  assert.equal(result.deletedCount, 2);
  assert.deepEqual(deletedStorageKeys, [
    "activity-1/sheet-1.csv",
    "activity-1/sheet-2.csv",
  ]);
  assert.deepEqual(calls, [
    "beginTransaction",
    "cleanupProcessing:derived-upload-1",
    "deleteJobs:derived-upload-1",
    "deleteUpload:derived-upload-1",
    "cleanupProcessing:derived-upload-2",
    "deleteJobs:derived-upload-2",
    "deleteUpload:derived-upload-2",
    "commitTransaction",
  ]);
});
