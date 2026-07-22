import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import type { InterpretationArtifactService } from "../../interpretation/interpretationArtifactService.js";
import type { ParsedRepresentationRepository } from "../../processing/parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "../../processing/privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "../../processing/privacySafeRepresentationRepository.js";
import type { FileStorageService } from "../../upload/fileStorageService.js";
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
    ...(overrides?.processingJobRepository ?? {}),
  } as unknown as ProcessingJobRepository;

  const uploadMetadataRepository = {} as UploadMetadataRepository;

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

  const fileStorageService = {} as FileStorageService;

  const logger = {
    info: () => undefined,
    warn: () => undefined,
  } as const;

  return new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
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
