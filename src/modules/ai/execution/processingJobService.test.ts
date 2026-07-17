import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../../shared/errors/appError.js";
import type { AuthorizationService } from "../../../shared/auth/authorizationService.js";
import type { UploadMetadataRepository } from "../../upload/uploadMetadataRepository.js";
import type { EvidenceProcessingArtifactService } from "../../processing/evidenceProcessingArtifactService.js";
import type { InterpretationArtifactService } from "../../interpretation/interpretationArtifactService.js";
import type { PythonProcessingClient } from "../../processing/pythonProcessingClient.js";
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
      pythonJob: {
        externalJobId: "python-job-1",
      },
    },
    errorMessage: null,
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
  pythonProcessingClient?: Partial<PythonProcessingClient>;
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

  const pythonProcessingClient = {
    getProcessingJobStatus: async () => ({
      externalJobId: "python-job-1",
      status: "processing",
      updatedAt: "2026-07-16T18:00:05.000Z",
      details: null,
    }),
    ...(overrides?.pythonProcessingClient ?? {}),
  } as unknown as PythonProcessingClient;

  const evidenceProcessingArtifactService = {
    ingestProcessorArtifacts: async () => undefined,
    ...(overrides?.evidenceProcessingArtifactService ?? {}),
  } as unknown as EvidenceProcessingArtifactService;

  const interpretationArtifactService = {
    ingestProcessorArtifacts: async () => undefined,
    ...(overrides?.interpretationArtifactService ?? {}),
  } as unknown as InterpretationArtifactService;

  const logger = {
    info: () => undefined,
    warn: () => undefined,
  } as const;

  return new ProcessingJobService(
    processingJobRepository,
    uploadMetadataRepository,
    authorizationService,
    pythonProcessingClient,
    evidenceProcessingArtifactService,
    interpretationArtifactService,
    logger as never,
  );
}

test("sync marks the local job failed when the external Python job is missing", async () => {
  let updatedInput:
    | {
        status?: string;
        errorMessage?: string | null;
        completedAt?: Date | null;
        payload?: Record<string, unknown> | null;
      }
    | undefined;

  const service = createService({
    processingJobRepository: {
      update: async (
        _processingJobId: string,
        input: ProcessingJobUpdateInput,
      ) => {
        updatedInput = input;
        return buildJob({
          status: input.status ?? "processing",
          payload: input.payload ?? null,
          errorMessage: input.errorMessage ?? null,
          completedAt: input.completedAt ?? null,
        });
      },
    },
    pythonProcessingClient: {
      getProcessingJobStatus: async () => {
        throw new AppError(
          "The Python processing service no longer has this job.",
          404,
          "python_processing_job_not_found",
        );
      },
    },
  });

  const syncedJob = await service.sync("user-1", "job-1");

  assert.equal(syncedJob.status, "failed");
  assert.match(
    syncedJob.errorMessage ?? "",
    /external Python processing job is no longer available/i,
  );
  assert.equal(updatedInput?.status, "failed");
  assert.equal(
    (updatedInput?.payload as Record<string, unknown> | undefined)?.sync
      ? (
          (updatedInput?.payload as Record<string, unknown>).sync as Record<
            string,
            unknown
          >
        ).failureCode
      : null,
    "python_processing_job_not_found",
  );
});

test("sync still surfaces ordinary Python status polling failures", async () => {
  const service = createService({
    pythonProcessingClient: {
      getProcessingJobStatus: async () => {
        throw new AppError(
          "The Python processing service did not return a job status.",
          502,
          "python_processing_status_unavailable",
        );
      },
    },
  });

  await assert.rejects(
    service.sync("user-1", "job-1"),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "python_processing_status_unavailable",
  );
});
