import assert from "node:assert/strict";
import test from "node:test";
import type { MultipartFile } from "@fastify/multipart";
import type { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import { AppError } from "../../../shared/errors/appError.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import type { InterpretationArtifactService } from "../../interpretation/interpretationArtifactService.js";
import type { ParsedRepresentationRepository } from "../../processing/parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "../../processing/privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "../../processing/privacySafeRepresentationRepository.js";
import type { FileStorageService } from "../../upload/fileStorageService.js";
import type { UploadMetadataService } from "../../upload/uploadMetadataService.js";
import type { ProcessingJobPersistenceRecord } from "../persistence/aiPersistenceTypes.js";
import type { ProcessingJobUpdateInput } from "../persistence/aiPersistenceTypes.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";
import { ProcessingJobService } from "./processingJobService.js";

function buildJob(
  overrides?: Partial<ProcessingJobPersistenceRecord>,
): ProcessingJobPersistenceRecord {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    triggeredById: "user-1",
    jobType: "evidence_processing",
    status: "processing",
    payload: {
      source: "backend",
    },
    errorMessage: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    attemptCount: 0,
    nextAttemptAt: null,
    failureCode: null,
    maxAttempts: 3,
    startedAt: new Date("2026-07-16T18:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2026-07-16T18:00:00.000Z"),
    updatedAt: new Date("2026-07-16T18:00:00.000Z"),
    ...overrides,
  };
}

function createService(overrides?: {
  processingJobRepository?: Partial<ProcessingJobRepository>;
  authorizationService?: Partial<AuthorizationService>;
  evidenceProcessingArtifactService?: Partial<EvidenceProcessingArtifactService>;
  interpretationArtifactService?: Partial<InterpretationArtifactService>;
  uploadMetadataService?: Partial<UploadMetadataService>;
  fileStorageService?: Partial<FileStorageService>;
}) {
  const processingJobRepository = {
    findById: async () => buildJob(),
    update: async (_processingJobId: string, input: ProcessingJobUpdateInput) =>
      buildJob({
        status: input.status ?? "processing",
        payload: input.payload ?? null,
        errorMessage: input.errorMessage ?? null,
        leaseOwner: input.leaseOwner ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        lastHeartbeatAt: input.lastHeartbeatAt ?? null,
        attemptCount: input.attemptCount ?? 0,
        nextAttemptAt: input.nextAttemptAt ?? null,
        failureCode: input.failureCode ?? null,
        maxAttempts: input.maxAttempts ?? 3,
        completedAt: input.completedAt ?? null,
      }),
    listByActivity: async () => [],
    create: async () => buildJob(),
    listRecentByProject: async () => [],
    countByActivityIds: async () => ({}),
    countByProjectStatuses: async () => 0,
    countByProjectTypeStatuses: async () => 0,
    findActiveByUploadMetadataId: async () => null,
    deleteByActivity: async () => 0,
    deleteByUploadMetadataId: async () => 0,
    cancelIfActive: async () => null,
    completeIfLeaseOwned: async (input: {
      processingJobId: string;
      workerId: string;
      status: "completed" | "failed";
      errorMessage: string | null;
      completedAt: Date;
    }) =>
      buildJob({
        status: input.status,
        errorMessage: input.errorMessage,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        completedAt: input.completedAt,
      }),
    ...(overrides?.processingJobRepository ?? {}),
  } as unknown as ProcessingJobRepository;

  const uploadMetadataRepository = {} as UploadMetadataRepository;
  const uploadMetadataService = {
    createDerivedWorkbookSheetUpload: async () => ({
      upload: {
        id: "derived-upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        sourceWorkbookUploadMetadataId: "upload-1",
        derivedSheetName: "Sheet 1",
        derivedSheetIndex: 0,
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
        uploadedById: "user-1",
        uploadedByName: "User One",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:00:00.000Z",
      },
      created: true,
    }),
    cleanupDerivedWorkbookSheetUploads: async () => ({
      deletedCount: 0,
    }),
    ...(overrides?.uploadMetadataService ?? {}),
  } as unknown as UploadMetadataService;

  const authorizationService = {
    canViewProject: async () => undefined,
    ...(overrides?.authorizationService ?? {}),
  } as unknown as AuthorizationService;

  const evidenceProcessingArtifactService = {
    ingestProcessorArtifacts: async () => undefined,
    ...(overrides?.evidenceProcessingArtifactService ?? {}),
  } as unknown as EvidenceProcessingArtifactService;

  const interpretationArtifactService = {
    ingestProcessorArtifacts: async () => undefined,
    ...(overrides?.interpretationArtifactService ?? {}),
  } as unknown as InterpretationArtifactService;

  const parsedRepresentationRepository = {
    findByProcessingJobId: async () => null,
  } as unknown as ParsedRepresentationRepository;

  const privacyReviewRepository = {
    findByProcessingJobId: async () => null,
  } as unknown as PrivacyReviewRepository;

  const privacySafeRepresentationRepository = {
    findById: async () => null,
  } as unknown as PrivacySafeRepresentationRepository;

  const fileStorageService = {
    storeActivityUpload: async () => ({
      originalFileName: "sheet-1.csv",
      contentType: "text/csv",
      sizeBytes: 128,
      storageKey: "activity-1/sheet-1.csv",
    }),
    deleteStoredFiles: async () => undefined,
    ...(overrides?.fileStorageService ?? {}),
  } as unknown as FileStorageService;

  const logger = {
    info: () => undefined,
    warn: () => undefined,
  } as const;

  return new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
    uploadMetadataService,
    authorizationService,
    evidenceProcessingArtifactService,
    interpretationArtifactService,
    parsedRepresentationRepository,
    privacyReviewRepository,
    privacySafeRepresentationRepository,
    fileStorageService,
    logger as never,
  );
}

test("sync returns the current backend job without external polling", async () => {
  const service = createService();

  const syncedJob = await service.sync("user-1", "job-1");

  assert.equal(syncedJob.id, "job-1");
  assert.equal(syncedJob.status, "processing");
  assert.equal(syncedJob.errorMessage, null);
});

test("sync surfaces persisted backend failure state as-is", async () => {
  const service = createService({
    processingJobRepository: {
      findById: async () =>
        buildJob({
          status: "failed",
          errorMessage: "Worker exhausted retries.",
          failureCode: "max_attempts_exhausted",
          completedAt: new Date("2026-07-16T18:05:00.000Z"),
        }),
    },
  });

  const syncedJob = await service.sync("user-1", "job-1");

  assert.equal(syncedJob.status, "failed");
  assert.equal(syncedJob.errorMessage, "Worker exhausted retries.");
});

test("completeBackendExecutedJob persists the outcome when the worker still holds the job's lease", async () => {
  let completeIfLeaseOwnedCall:
    { processingJobId: string; workerId: string } | undefined;
  const service = createService({
    processingJobRepository: {
      findById: async () =>
        buildJob({ status: "processing", leaseOwner: "worker-a" }),
      completeIfLeaseOwned: async (input) => {
        completeIfLeaseOwnedCall = input;
        return buildJob({
          status: input.status,
          errorMessage: input.errorMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          completedAt: input.completedAt,
        });
      },
    },
  });

  const result = await service.completeBackendExecutedJob("job-1", "worker-a", {
    status: "completed",
  });

  assert.equal(result.status, "completed");
  assert.equal(completeIfLeaseOwnedCall?.processingJobId, "job-1");
  assert.equal(completeIfLeaseOwnedCall?.workerId, "worker-a");
});

test("completeBackendExecutedJob does not overwrite the job when its lease was reclaimed by another worker", async () => {
  // Regression test: a stale worker (worker-a) whose lease already expired
  // and was reclaimed by worker-b used to be able to overwrite worker-b's
  // in-progress/completed state, since completion previously updated the
  // job unconditionally rather than checking lease ownership.
  const reclaimedJob = buildJob({
    status: "processing",
    leaseOwner: "worker-b",
  });
  const service = createService({
    processingJobRepository: {
      findById: async () => reclaimedJob,
      // Simulates the atomic ownership-scoped update finding no matching
      // document, because leaseOwner is now "worker-b", not "worker-a".
      completeIfLeaseOwned: async () => null,
    },
  });

  const result = await service.completeBackendExecutedJob("job-1", "worker-a", {
    status: "completed",
  });

  // The stale worker's completion call must not appear to have succeeded
  // with its own outcome — it should reflect the job's actual current
  // state (still owned and being processed by worker-b), not "completed".
  assert.equal(result.status, "processing");
});

test("create surfaces a clean 409 when the repository rejects a duplicate active activity_analysis_v2 job", async () => {
  // The real repository (MongoProcessingJobRepository) relies on a
  // database-level partial unique index on {activityId, jobType:
  // "activity_analysis_v2", status: active} to guarantee only one such job
  // can be active per activity at a time — this test only proves the
  // service layer propagates that rejection cleanly rather than swallowing
  // or corrupting it; the index itself is verified separately against a
  // real MongoDB instance (concurrent creates: exactly one succeeds, the
  // rest get a clean 409 processing_job_already_active).
  const service = createService({
    processingJobRepository: {
      create: async () => {
        throw new AppError(
          "A processing job is already active for this evidence version.",
          409,
          "processing_job_already_active",
        );
      },
    },
    authorizationService: {
      canEditProject: async () => ({
        project: { id: "project-1", organizationId: "org-1" },
      }),
      canEditActivity: async () => ({
        activity: { id: "activity-1", projectId: "project-1" },
      }),
    } as unknown as Partial<AuthorizationService>,
  });

  await assert.rejects(
    service.create("user-1", "project-1", {
      activityId: "activity-1",
      jobType: "activity_analysis_v2",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "processing_job_already_active");
      return true;
    },
  );
});

test("createDerivedWorkbookSheetUpload rejects a workbook split job that is no longer active", async () => {
  const service = createService({
    processingJobRepository: {
      findById: async () =>
        buildJob({
          jobType: "workbook_split",
          status: "cancelled",
        }),
    },
  });

  await assert.rejects(
    service.createDerivedWorkbookSheetUpload("job-1", {} as MultipartFile, {
      sheetName: "Sheet 1",
      sheetIndex: 0,
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "workbook_split_job_not_active",
  );
});

test("createDerivedWorkbookSheetUpload forwards uploads for an active workbook split job", async () => {
  let capturedInput:
    | Parameters<UploadMetadataService["createDerivedWorkbookSheetUpload"]>[0]
    | undefined;

  const service = createService({
    processingJobRepository: {
      findById: async () =>
        buildJob({
          jobType: "workbook_split",
          status: "processing",
        }),
    },
    uploadMetadataService: {
      createDerivedWorkbookSheetUpload: async (input) => {
        capturedInput = input;
        return {
          upload: {
            id: "derived-upload-1",
            organizationId: "org-1",
            projectId: "project-1",
            activityId: "activity-1",
            sourceWorkbookUploadMetadataId: "upload-1",
            derivedSheetName: "Sheet 1",
            derivedSheetIndex: 0,
            logicalEvidenceId: "logical-1",
            versionNumber: 1,
            replacesUploadMetadataId: null,
            supersededAt: null,
            originalFileName: "Sheet 1.csv",
            contentType: "text/csv",
            sizeBytes: 256,
            storageKey: "activity-1/sheet-1.csv",
            originalFileDeletedAt: null,
            status: "uploaded",
            uploadedById: "user-1",
            uploadedByName: "User One",
            createdAt: "2026-07-30T10:00:00.000Z",
            updatedAt: "2026-07-30T10:00:00.000Z",
          },
          created: true,
        };
      },
    },
    fileStorageService: {
      storeActivityUpload: async () => ({
        originalFileName: "Sheet 1.csv",
        contentType: "text/csv",
        sizeBytes: 256,
        storageKey: "activity-1/sheet-1.csv",
      }),
    },
  });

  await service.createDerivedWorkbookSheetUpload("job-1", {} as MultipartFile, {
    sheetName: "Sheet 1",
    sheetIndex: 0,
  });

  assert.deepEqual(capturedInput, {
    sourceWorkbookUploadMetadataId: "upload-1",
    triggeredById: "user-1",
    originalFileName: "Sheet 1.csv",
    contentType: "text/csv",
    sizeBytes: 256,
    storageKey: "activity-1/sheet-1.csv",
    derivedSheetName: "Sheet 1",
    derivedSheetIndex: 0,
  });
});

test("createDerivedWorkbookSheetUpload deletes the stored sheet if the workbook split job becomes inactive before insert", async () => {
  let findByIdCallCount = 0;
  let deletedStorageKeys: string[] = [];

  const service = createService({
    processingJobRepository: {
      findById: async () => {
        findByIdCallCount += 1;

        if (findByIdCallCount === 1) {
          return buildJob({
            jobType: "workbook_split",
            status: "processing",
          });
        }

        return buildJob({
          jobType: "workbook_split",
          status: "cancelled",
        });
      },
    },
    uploadMetadataService: {
      createDerivedWorkbookSheetUpload: async () => {
        throw new Error(
          "createDerivedWorkbookSheetUpload should not be called",
        );
      },
    },
    fileStorageService: {
      storeActivityUpload: async () => ({
        originalFileName: "Sheet 1.csv",
        contentType: "text/csv",
        sizeBytes: 256,
        storageKey: "activity-1/sheet-1.csv",
      }),
      deleteStoredFiles: async (storageKeys) => {
        deletedStorageKeys = storageKeys;
      },
    },
  });

  await assert.rejects(
    service.createDerivedWorkbookSheetUpload("job-1", {} as MultipartFile, {
      sheetName: "Sheet 1",
      sheetIndex: 0,
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "workbook_split_job_not_active",
  );

  assert.deepEqual(deletedStorageKeys, ["activity-1/sheet-1.csv"]);
});

test("rollbackDerivedWorkbookSheetUploads cleans up derived uploads for a workbook split job", async () => {
  let cleanedSourceWorkbookUploadMetadataId: string | undefined;

  const service = createService({
    processingJobRepository: {
      findById: async () =>
        buildJob({
          jobType: "workbook_split",
          uploadMetadataId: "source-upload-1",
        }),
    },
    uploadMetadataService: {
      cleanupDerivedWorkbookSheetUploads: async (
        sourceWorkbookUploadMetadataId,
      ) => {
        cleanedSourceWorkbookUploadMetadataId = sourceWorkbookUploadMetadataId;
        return { deletedCount: 2 };
      },
    },
  });

  const result = await service.rollbackDerivedWorkbookSheetUploads("job-1");

  assert.equal(cleanedSourceWorkbookUploadMetadataId, "source-upload-1");
  assert.equal(result.deletedCount, 2);
});
