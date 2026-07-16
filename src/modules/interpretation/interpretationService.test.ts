import assert from "node:assert/strict";
import test from "node:test";
import { InterpretationService } from "./interpretationService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import type { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function createDependencies(options: {
  buildForProject: () => Promise<unknown>;
}) {
  const uploadMetadataRepository = {
    listByActivityIds: async () => [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
      },
    ],
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            interpretationDataType: "tabular_structured",
            evidenceModality: "structured_quantitative",
          },
        },
      },
    ],
  } as unknown as PrivacySafeRepresentationRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        questions: [],
      },
    ],
  } as unknown as InterpretationResultRepository;

  const processingJobRepository = {} as unknown as ProcessingJobRepository;

  const activityRepository = {
    update: async () => ({
      id: "activity-1",
      projectId: "project-1",
      name: "Activity",
      interpretationAcknowledgedAt: NOW,
      interpretationAcknowledgedById: "user-1",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: { id: "project-1", organizationId: "org-1", ownerId: "user-1" },
      activity: { id: "activity-1", projectId: "project-1" },
    }),
  } as unknown as AuthorizationService;

  const pythonProcessingClient = {} as unknown as PythonProcessingClient;

  const logger = {
    info: () => {},
    error: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;

  const datasetPreparationService = {
    findByInterpretationResultIds: async () => [],
    findByInterpretationResultId: async () => null,
    syncForInterpretationResult: async () => ({
      id: "prep-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      privacySafeRepresentationId: "psr-1",
      interpretationResultId: "result-1",
      status: "ready_for_analysis",
      blockingQuestionCount: 0,
      answeredBlockingQuestionCount: 0,
      unansweredBlockingQuestionIds: [],
      decisions: [],
      decisionSummary: {
        normalizationMerges: [],
        rowGrains: [],
        duplicateIdentifierResolutions: [],
        primaryStatusFields: [],
        positiveStatusDefinitions: [],
        primaryDateFields: [],
      },
      createdAt: NOW,
      updatedAt: NOW,
    }),
    markAnalysisCompleted: async (
      preparation: Awaited<
        ReturnType<DatasetPreparationService["syncForInterpretationResult"]>
      >,
    ) => ({
      ...preparation,
      status: "analysis_completed",
    }),
  } as unknown as DatasetPreparationService;

  const projectKnowledgeBuilderService = {
    buildForProject: options.buildForProject,
  } as unknown as ProjectKnowledgeBuilderService;
  const deterministicAnalysisService = {
    findByInterpretationResultIds: async () => [],
    findByInterpretationResultId: async () => null,
    syncForInterpretationResult: async () => ({
      id: "analysis-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      privacySafeRepresentationId: "psr-1",
      interpretationResultId: "result-1",
      datasetPreparationId: "prep-1",
      status: "ready",
      metrics: [],
      distributions: [],
      trends: [],
      subgroupBreakdowns: [],
      categoricalCrosstabs: [],
      numericCategorySummaries: [],
      numericCorrelations: [],
      warnings: [],
      candidateIndicators: [],
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as DeterministicAnalysisService;
  const quantitativeInterpretationSynthesisService = {
    maybeSyncForInterpretationResult: async () => null,
  } as unknown as QuantitativeInterpretationSynthesisService;

  return {
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    interpretationResultRepository,
    processingJobRepository,
    activityRepository,
    authorizationService,
    pythonProcessingClient,
    logger,
    datasetPreparationService,
    deterministicAnalysisService,
    quantitativeInterpretationSynthesisService,
    projectKnowledgeBuilderService,
  };
}

test("acknowledging an activity triggers a Project Knowledge Model rebuild for its project", async () => {
  let buildCallCount = 0;
  let builtProjectId: string | null = null;
  const deps = createDependencies({ buildForProject: async () => ({}) });
  deps.projectKnowledgeBuilderService.buildForProject = async (
    projectId: string,
  ) => {
    buildCallCount += 1;
    builtProjectId = projectId;
    return {} as never;
  };

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.interpretationResultRepository,
    deps.processingJobRepository,
    deps.activityRepository,
    deps.authorizationService,
    deps.pythonProcessingClient,
    deps.logger,
    deps.datasetPreparationService,
    deps.deterministicAnalysisService,
    deps.quantitativeInterpretationSynthesisService,
    deps.projectKnowledgeBuilderService,
  );

  await service.acknowledgeReview("user-1", "activity-1");

  assert.equal(buildCallCount, 1);
  assert.equal(builtProjectId, "project-1");
});

test("a rebuild failure never prevents the acknowledgment from succeeding", async () => {
  const deps = createDependencies({
    buildForProject: async () => {
      throw new Error("Mongo unavailable.");
    },
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.interpretationResultRepository,
    deps.processingJobRepository,
    deps.activityRepository,
    deps.authorizationService,
    deps.pythonProcessingClient,
    deps.logger,
    deps.datasetPreparationService,
    deps.deterministicAnalysisService,
    deps.quantitativeInterpretationSynthesisService,
    deps.projectKnowledgeBuilderService,
  );

  const activity = await service.acknowledgeReview("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
});
