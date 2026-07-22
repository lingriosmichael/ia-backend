import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { InterpretationArtifactService } from "./interpretationArtifactService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import type { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type {
  InterpretationResultCreateInput,
  InterpretationResultPersistenceRecord,
} from "./interpretationResultPersistence.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";

function buildJob(
  overrides?: Partial<ProcessingJobPersistenceRecord>,
): ProcessingJobPersistenceRecord {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: null,
    uploadMetadataId: "upload-1",
    triggeredById: "user-1",
    jobType: "dataset_interpretation",
    status: "processing",
    payload: {
      privacySafeRepresentationId: "privacy-safe-1",
    },
    errorMessage: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    attemptCount: 0,
    nextAttemptAt: null,
    failureCode: null,
    maxAttempts: 3,
    startedAt: new Date("2026-07-17T09:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2026-07-17T09:00:00.000Z"),
    updatedAt: new Date("2026-07-17T09:00:00.000Z"),
    ...overrides,
  };
}

function buildCreatedResult(
  input: InterpretationResultCreateInput,
): InterpretationResultPersistenceRecord {
  return {
    id: "interpretation-1",
    organizationId: input.organizationId,
    projectId: input.projectId,
    activityId: input.activityId,
    uploadMetadataId: input.uploadMetadataId,
    privacySafeRepresentationId: input.privacySafeRepresentationId,
    processingJobId: input.processingJobId,
    versionNumber: input.versionNumber,
    previousInterpretationResultId: input.previousInterpretationResultId,
    datasetType: input.datasetType,
    overallConfidence: input.overallConfidence,
    evidenceRouting: input.evidenceRouting,
    datasetProfile: input.datasetProfile,
    entities: [],
    indicators: [],
    relationships: [],
    qualitativeFindings: [],
    supportingQuotes: [],
    questions: [],
    warnings: [],
    goalAlignment: [],
    llmUsage: input.llmUsage,
    createdAt: new Date("2026-07-17T09:01:00.000Z"),
    updatedAt: new Date("2026-07-17T09:01:00.000Z"),
  };
}

function requireCreateInput(
  input: InterpretationResultCreateInput | null,
): InterpretationResultCreateInput {
  if (!input) {
    throw new Error("Expected interpretation result create input.");
  }
  return input;
}

test("ingestProcessorArtifacts persists interpretation llmUsage calls", async () => {
  let capturedCreateInput: InterpretationResultCreateInput | null = null;
  let capturedLedgerUsage: LlmUsageSummary | null = null;

  const interpretationResultRepository = {
    findLatestByPrivacySafeRepresentationId: async () => null,
    create: async (input: InterpretationResultCreateInput) => {
      capturedCreateInput = input;
      return buildCreatedResult(input);
    },
  } as unknown as InterpretationResultRepository;

  const datasetPreparationService = {
    syncForInterpretationResult: async () =>
      ({
        id: "prep-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: null,
        uploadMetadataId: "upload-1",
        privacySafeRepresentationId: "privacy-safe-1",
        interpretationResultId: "interpretation-1",
        status: "ready",
        blockingQuestionCount: 0,
        answeredBlockingQuestionCount: 0,
        unansweredBlockingQuestionIds: [],
        decisions: [],
        decisionSummary: {
          unresolvedBlockingCount: 0,
          unresolvedBlockingQuestionIds: [],
          normalizationPendingCount: 0,
          normalizationResolvedCount: 0,
          rowGrainResolved: true,
          primaryStatusResolved: true,
          primaryDateResolved: true,
        },
        preparedDataset: null,
        createdAt: new Date("2026-07-17T09:01:00.000Z"),
        updatedAt: new Date("2026-07-17T09:01:00.000Z"),
      }) as never,
    markAnalysisCompleted: async (preparation: unknown) => preparation as never,
  } as unknown as DatasetPreparationService;

  const deterministicAnalysisService = {
    syncForInterpretationResult: async () =>
      ({
        id: "analysis-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: null,
        uploadMetadataId: "upload-1",
        privacySafeRepresentationId: "privacy-safe-1",
        interpretationResultId: "interpretation-1",
        datasetPreparationId: "prep-1",
        status: "not_applicable",
        metrics: [],
        distributions: [],
        trends: [],
        subgroupBreakdowns: [],
        categoricalCrosstabs: [],
        numericCategorySummaries: [],
        numericCorrelations: [],
        warnings: [],
        candidateIndicators: [],
        createdAt: new Date("2026-07-17T09:01:00.000Z"),
        updatedAt: new Date("2026-07-17T09:01:00.000Z"),
      }) as never,
  } as unknown as DeterministicAnalysisService;

  const quantitativeInterpretationSynthesisService = {
    maybeSyncForInterpretationResult: async () => undefined,
  } as unknown as QuantitativeInterpretationSynthesisService;

  const projectLlmTokenLedgerService = {
    recordUsage: async (
      _projectId: string,
      usage: InterpretationResultCreateInput["llmUsage"],
    ) => {
      capturedLedgerUsage = usage;
    },
  } as unknown as ProjectLlmTokenLedgerService;

  const logger = {
    child: () => logger,
    info: () => undefined,
    trace: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    debug: () => undefined,
    level: "info",
    silent: () => undefined,
  } as unknown as FastifyBaseLogger;

  const service = new InterpretationArtifactService(
    interpretationResultRepository,
    {} as ActivityRepository,
    datasetPreparationService,
    deterministicAnalysisService,
    quantitativeInterpretationSynthesisService,
    projectLlmTokenLedgerService,
    logger,
  );

  await service.ingestProcessorArtifacts(
    buildJob(),
    {
      interpretation: {
        datasetType: "structured_qualitative",
        overallConfidence: 0.81,
        entities: [],
        indicators: [],
        relationships: [],
        qualitativeFindings: [],
        supportingQuotes: [],
        questions: [],
        warnings: [],
        goalAlignment: [],
      },
      llmUsage: {
        totalCalls: 2,
        totalPromptTokens: 1200,
        totalCompletionTokens: 240,
        totalTokens: 1440,
        calls: [
          {
            stageName: "classify_dataset",
            model: "gpt-4.1-mini",
            promptTokens: 400,
            completionTokens: 80,
            totalTokens: 480,
            durationMs: 900,
          },
          {
            stageName: "extract_indicators",
            model: "gpt-4.1-mini",
            promptTokens: 800,
            completionTokens: 160,
            totalTokens: 960,
            durationMs: 1400,
          },
        ],
      },
    },
    "completed",
  );

  const createdInput = requireCreateInput(capturedCreateInput);
  assert.deepEqual(createdInput.llmUsage, {
    totalCalls: 2,
    totalPromptTokens: 1200,
    totalCompletionTokens: 240,
    totalTokens: 1440,
    calls: [
      {
        stageName: "classify_dataset",
        model: "gpt-4.1-mini",
        promptTokens: 400,
        completionTokens: 80,
        totalTokens: 480,
        durationMs: 900,
      },
      {
        stageName: "extract_indicators",
        model: "gpt-4.1-mini",
        promptTokens: 800,
        completionTokens: 160,
        totalTokens: 960,
        durationMs: 1400,
      },
    ],
  });
  assert.deepEqual(capturedLedgerUsage, createdInput.llmUsage);
});
