import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import { InterpretationService } from "./interpretationService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { EvidenceLinkageReconciliationService } from "../linkage/evidenceLinkageReconciliationService.js";
import type { ActivityEvidenceLinkageResultRepository } from "../linkage/activityEvidenceLinkageResultRepository.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import type { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { ProcessingJobCreateInput } from "../ai/persistence/aiPersistenceTypes.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function createDependencies(options: {
  buildForProject: () => Promise<unknown>;
  generatedSummaryText?: string;
  activities?: Array<{
    id: string;
    projectId: string;
    name: string;
    objectives?: string | null;
    output?: string | null;
    interpretationAcknowledgedAt: Date | null;
  }>;
  uploads?: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    activityId: string;
    originalFileName?: string;
  }>;
  privacySafeRepresentations?: Array<{
    id: string;
    uploadMetadataId: string;
    payload: Record<string, unknown>;
  }>;
  processingJobs?: ProcessingJobPersistenceRecord[];
  results?: Array<{
    id: string;
    uploadMetadataId: string;
    activityId: string;
    datasetProfile?: {
      tables: Array<{
        columns: Array<{
          epistemicRole:
            | "identifier"
            | "temporal"
            | "validated_scale"
            | "metric_count"
            | "subjective_code"
            | "free_text"
            | "flag"
            | null;
        }>;
      }>;
    } | null;
    updatedAt?: Date;
    projectId?: string;
    questions?: Array<{
      id: string;
      isBlocking: boolean;
      status: "pending" | "answered";
      kind?: "single_choice" | "free_text" | "merge_confirmation";
      options?: string[] | null;
      answeredValue?: string | null;
    }>;
    qualitativeFindings?: Array<{
      id: string;
      summary: string;
      confidence: number;
      status: "kept" | "rejected";
      outcomeAnchorType:
        | "project_goal"
        | "project_success_indicator"
        | "activity_objective"
        | "activity_output"
        | "activity_outcome"
        | "unanchored";
      relationToEvidence:
        "reinforces" | "contradicts" | "complicates" | "context_only";
      category:
        "outcome" | "barrier" | "enabler" | "recommendation" | "context_only";
    }>;
    goalAlignment?: Array<{
      id: string;
      goalSummary: string;
      isSupportedByData: boolean;
      gapExplanation: string | null;
    }>;
    indicators?: Array<{
      id: string;
      name: string;
      confidence: number;
      status: "kept" | "rejected";
      matchesStatedGoal: boolean;
      relevanceStage:
        "input" | "activity" | "output" | "outcome" | "impact" | null;
      computedValue?: {
        value: number;
        recordsIncluded: number;
        recordsExcluded: number;
        components?: Record<string, unknown>;
      } | null;
    }>;
    entities?: Array<{ originalField: string; aiMeaning: string }>;
  }>;
  qualitativeCodingReviews?: Array<{
    uploadMetadataId: string;
    status: "pending" | "approved" | "rejected";
    findings?: Record<string, unknown>;
    decisions?: Record<string, unknown> | null;
  }>;
  deterministicAnalyses?: Array<{
    id: string;
    interpretationResultId: string;
    uploadMetadataId: string;
    activityId: string;
    metrics?: Array<{
      metricKey: string;
      label: string;
      description: string;
      tableName: string;
      sourceColumns: string[];
      kind: string;
      formula: string;
      value: number | null;
      unit: string | null;
      components: Record<string, unknown>;
    }>;
    distributions?: Array<{
      distributionKey: string;
      label: string;
      tableName: string;
      columnName: string;
      buckets: Array<{
        value: string | null;
        count: number;
        ratio: number | null;
      }>;
    }>;
    subgroupBreakdowns?: Array<{
      breakdownKey: string;
      label: string;
      tableName: string;
      columnName: string;
      segments: Array<{
        value: string | null;
        rowCount: number;
        positiveCount: number | null;
        positiveRatio: number | null;
      }>;
    }>;
  }>;
}) {
  const project = {
    id: "project-1",
    organizationId: "org-1",
    ownerId: "user-1",
    name: "Project",
    projectGoal: "Improve mentor readiness",
    impactModel: {
      inputs: null,
      activities: null,
      outputs: null,
      outcomes: "mentors are well prepared",
      impact: "young people receive better support",
    },
    successIndicators: "high mentor quality",
  };
  const activities = options.activities ?? [
    {
      id: "activity-1",
      projectId: "project-1",
      name: "Activity",
      objectives: "prepare mentors",
      output: "Two orientation sessions run",
      interpretationAcknowledgedAt: NOW,
    },
  ];
  const uploads = options.uploads ?? [
    {
      id: "upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      originalFileName: "upload-1.csv",
    },
  ];
  const privacySafeRepresentations = options.privacySafeRepresentations ?? [
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
  ];
  const processingJobs = [...(options.processingJobs ?? [])];
  const createdJobs: ProcessingJobPersistenceRecord[] = [];
  const qualitativeCodingReviews = options.qualitativeCodingReviews ?? [];
  const results = options.results ?? [
    {
      id: "result-1",
      uploadMetadataId: "upload-1",
      activityId: "activity-1",
      datasetProfile: null,
      updatedAt: NOW,
      questions: [],
      qualitativeFindings: [],
      goalAlignment: [],
      indicators: [],
    },
  ];

  const uploadMetadataRepository = {
    listByActivityIds: async (activityIds: string[]) =>
      uploads.filter((upload) => activityIds.includes(upload.activityId)),
    findById: async (uploadMetadataId: string) =>
      uploads.find((upload) => upload.id === uploadMetadataId) ?? null,
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      privacySafeRepresentations.filter((representation) =>
        uploadMetadataIds.includes(representation.uploadMetadataId),
      ),
    findLatestByUploadMetadataId: async (uploadMetadataId: string) =>
      privacySafeRepresentations.find(
        (representation) =>
          representation.uploadMetadataId === uploadMetadataId,
      ) ?? null,
  } as unknown as PrivacySafeRepresentationRepository;

  const qualitativeCodingReviewRepository = {
    findByUploadMetadataId: async (uploadMetadataId: string) =>
      qualitativeCodingReviews.find(
        (review) => review.uploadMetadataId === uploadMetadataId,
      ) ?? null,
  } as unknown as QualitativeCodingReviewRepository;

  // Fully normalizes a fixture result (which only ever specifies the
  // fields a given test cares about) into the shape mapInterpretationResult
  // actually requires — findById/answerQuestion feed the real mapper, not
  // a mocked one, so a partial object throws deep inside mapping instead of
  // in the test itself.
  function normalizeResultForMapper(result: (typeof results)[number]) {
    return {
      id: result.id,
      organizationId: "org-1",
      projectId: result.projectId ?? "project-1",
      activityId: result.activityId,
      uploadMetadataId: result.uploadMetadataId,
      privacySafeRepresentationId: "psr-1",
      processingJobId: "job-1",
      versionNumber: 1,
      previousInterpretationResultId: null,
      datasetType: "tabular_structured",
      overallConfidence: 0.9,
      evidenceRouting: null,
      datasetProfile: result.datasetProfile ?? null,
      entities: result.entities ?? [],
      indicators: result.indicators ?? [],
      relationships: [],
      qualitativeFindings: result.qualitativeFindings ?? [],
      supportingQuotes: [],
      questions: (result.questions ?? []).map((question) => ({
        id: question.id,
        prompt: `Question ${question.id}`,
        kind: question.kind ?? "single_choice",
        questionDomain: "interpretation" as const,
        options: question.options ?? null,
        recommendedOption: null,
        recommendedConfidence: null,
        isBlocking: question.isBlocking,
        questionCode: null,
        targetTableName: null,
        targetColumnName: null,
        status: question.status,
        answeredValue: question.answeredValue ?? null,
        answeredById: null,
        answeredAt: null,
      })),
      warnings: [],
      goalAlignment: result.goalAlignment ?? [],
      llmUsage: null,
      synthesisStatus: null,
      synthesisError: null,
      createdAt: NOW,
      updatedAt: result.updatedAt ?? NOW,
    };
  }

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      results
        .filter((result) => uploadMetadataIds.includes(result.uploadMetadataId))
        .map((result) => ({
          datasetProfile: null,
          qualitativeFindings: [],
          goalAlignment: [],
          indicators: [],
          questions: [],
          updatedAt: NOW,
          ...result,
        })),
    findById: async (interpretationResultId: string) => {
      const result = results.find(
        (candidate) => candidate.id === interpretationResultId,
      );
      return result ? normalizeResultForMapper(result) : null;
    },
    answerQuestion: async (
      interpretationResultId: string,
      questionId: string,
      input: { answeredValue: string; answeredById: string; answeredAt: Date },
    ) => {
      const result = results.find(
        (candidate) => candidate.id === interpretationResultId,
      );
      const question = result?.questions?.find(
        (candidate) => candidate.id === questionId,
      );
      if (!result || !question) {
        return null;
      }
      question.status = "answered";
      question.answeredValue = input.answeredValue;
      return normalizeResultForMapper(result);
    },
  } as unknown as InterpretationResultRepository;

  const processingJobRepository = {
    listByActivity: async () => processingJobs,
    findActiveByUploadMetadataId: async (uploadMetadataId: string) => {
      const latestJob = processingJobs
        .filter((job) => job.uploadMetadataId === uploadMetadataId)
        .sort((left, right) => {
          return right.createdAt.getTime() - left.createdAt.getTime();
        })[0];

      if (
        !latestJob ||
        ["completed", "failed", "cancelled"].includes(latestJob.status)
      ) {
        return null;
      }

      return latestJob;
    },
    create: async (input: ProcessingJobCreateInput) => {
      const createdJob: ProcessingJobPersistenceRecord = {
        id: `job-${createdJobs.length + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        activityId: input.activityId,
        uploadMetadataId: input.uploadMetadataId,
        triggeredById: input.triggeredById,
        jobType: input.jobType,
        status: "queued",
        payload: input.payload ?? null,
        errorMessage: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        attemptCount: 0,
        nextAttemptAt: null,
        failureCode: null,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      createdJobs.push(createdJob);
      return createdJob;
    },
    update: async (
      processingJobId: string,
      input: Partial<ProcessingJobPersistenceRecord>,
    ) => {
      const job =
        createdJobs.find((createdJob) => createdJob.id === processingJobId) ??
        processingJobs.find(
          (existingJob) => existingJob.id === processingJobId,
        );

      assert.ok(job);

      return {
        ...job,
        ...input,
        payload:
          input.payload === undefined
            ? job.payload
            : (input.payload as Record<string, unknown> | null),
        updatedAt: NOW,
      };
    },
  } as unknown as ProcessingJobRepository;

  const activityRepository = {
    listByProject: async (projectId: string) =>
      activities.filter((activity) => activity.projectId === projectId),
    findById: async (activityId: string) =>
      activities.find((activity) => activity.id === activityId) ?? null,
    update: async (
      activityId: string,
      input: {
        interpretationAcknowledgedAt?: Date | null;
        interpretationAcknowledgedById?: string | null;
      },
    ) => ({
      id: activityId,
      projectId: "project-1",
      name:
        activities.find((activity) => activity.id === activityId)?.name ??
        "Activity",
      interpretationAcknowledgedAt: input.interpretationAcknowledgedAt ?? NOW,
      interpretationAcknowledgedById:
        input.interpretationAcknowledgedById ?? "user-1",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ActivityRepository;

  const authorizationService = {
    canViewProject: async () => ({
      project,
    }),
    canEditProject: async () => ({
      project,
    }),
    canViewActivity: async () => ({
      project,
      activity: activities[0],
    }),
    canEditActivity: async () => ({
      project,
      activity: activities[0],
    }),
  } as unknown as AuthorizationService;

  const pythonProcessingClient = {
    generateAiKnowledgeSummary: async () => ({
      summaryText:
        options.generatedSummaryText ??
        "Key patterns from the interpreted evidence are summarized here.",
    }),
  } as unknown as PythonProcessingClient;

  const logger = {
    info: () => {},
    warn: () => {},
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

  const deterministicAnalyses = options.deterministicAnalyses ?? [];
  const projectKnowledgeBuilderService = {
    buildForProject: options.buildForProject,
  } as unknown as ProjectKnowledgeBuilderService;
  const deterministicAnalysisService = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      deterministicAnalyses
        .filter((analysis) =>
          interpretationResultIds.includes(analysis.interpretationResultId),
        )
        .map((analysis) => ({
          id: analysis.id,
          organizationId: "org-1",
          projectId: "project-1",
          activityId: analysis.activityId,
          uploadMetadataId: analysis.uploadMetadataId,
          privacySafeRepresentationId: "psr-1",
          interpretationResultId: analysis.interpretationResultId,
          datasetPreparationId: "prep-1",
          status: "ready" as const,
          metrics: analysis.metrics ?? [],
          distributions: analysis.distributions ?? [],
          trends: [],
          subgroupBreakdowns: analysis.subgroupBreakdowns ?? [],
          categoricalCrosstabs: [],
          numericCategorySummaries: [],
          numericCorrelations: [],
          warnings: [],
          candidateIndicators: [],
          createdAt: NOW,
          updatedAt: NOW,
        })),
    findByInterpretationResultId: async (interpretationResultId: string) =>
      deterministicAnalyses
        .filter(
          (analysis) =>
            analysis.interpretationResultId === interpretationResultId,
        )
        .map((analysis) => ({
          id: analysis.id,
          organizationId: "org-1",
          projectId: "project-1",
          activityId: analysis.activityId,
          uploadMetadataId: analysis.uploadMetadataId,
          privacySafeRepresentationId: "psr-1",
          interpretationResultId: analysis.interpretationResultId,
          datasetPreparationId: "prep-1",
          status: "ready" as const,
          metrics: analysis.metrics ?? [],
          distributions: analysis.distributions ?? [],
          trends: [],
          subgroupBreakdowns: analysis.subgroupBreakdowns ?? [],
          categoricalCrosstabs: [],
          numericCategorySummaries: [],
          numericCorrelations: [],
          warnings: [],
          candidateIndicators: [],
          createdAt: NOW,
          updatedAt: NOW,
        }))[0] ?? null,
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
  const projectLlmTokenLedgerService = {
    recordUsage: async () => {},
  } as unknown as ProjectLlmTokenLedgerService;
  const evidenceLinkageReconciliationService = {
    reconcileForActivity: async () => null,
  } as unknown as EvidenceLinkageReconciliationService;
  const activityEvidenceLinkageResultRepository = {
    findByActivityId: async () => null,
  } as unknown as ActivityEvidenceLinkageResultRepository;

  return {
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    qualitativeCodingReviewRepository,
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
    projectLlmTokenLedgerService,
    evidenceLinkageReconciliationService,
    activityEvidenceLinkageResultRepository,
    createdJobs,
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
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
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
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const activity = await service.acknowledgeReview("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
});

test("activity interpretation starts from the latest completed evidence job even if an older job is still marked active", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    results: [],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "mentor_export.csv",
      },
    ],
    processingJobs: [
      {
        id: "job-old-active",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        triggeredById: "user-1",
        jobType: "evidence_processing",
        status: "awaiting_privacy_review",
        payload: null,
        errorMessage: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        attemptCount: 0,
        nextAttemptAt: null,
        failureCode: null,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "job-new-completed",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        triggeredById: "user-1",
        jobType: "evidence_processing",
        status: "completed",
        payload: null,
        errorMessage: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        attemptCount: 0,
        nextAttemptAt: null,
        failureCode: null,
        maxAttempts: 3,
        startedAt: null,
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ],
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const response = await service.startActivityInterpretation(
    "user-1",
    "activity-1",
    "de",
  );

  assert.equal(response.startedCount, 1);
  assert.equal(deps.createdJobs.length, 1);
  assert.equal(deps.createdJobs[0]?.jobType, "dataset_interpretation");
});

test("activity interpretation blocks reruns when every upload already has a latest interpretation result", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await assert.rejects(
    service.startActivityInterpretation("user-1", "activity-1", "de"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "activity_interpretation_not_ready",
      );
      return true;
    },
  );
  assert.equal(deps.createdJobs.length, 0);
});

test("getActivityWorkflowStage reports assessment_ready for a fully-interpreted single-upload activity", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        interpretationAcknowledgedAt: null,
      },
    ],
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, {
    activityId: "activity-1",
    stage: "assessment_ready",
  });
});

test("getActivityWorkflowStage waits for every upload before reporting clarification questions", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        interpretationAcknowledgedAt: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-1.csv",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-2.csv",
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
        questions: [
          {
            id: "question-1",
            isBlocking: true,
            status: "pending",
            kind: "single_choice",
            options: ["Yes", "No"],
          },
        ],
      },
    ],
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, {
    activityId: "activity-1",
    stage: "analysis_pending",
  });
});

test("getActivityWorkflowStage reports qualitative_review when an interpreted upload still needs coding review approval", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        interpretationAcknowledgedAt: null,
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        datasetProfile: {
          tables: [
            {
              rowCount: 3,
              columns: [
                { epistemicRole: "free_text", nonNullCount: 3 } as never,
              ],
            } as never,
          ],
        },
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, {
    activityId: "activity-1",
    stage: "qualitative_review",
  });
});

test("getActivityWorkflowStage reports goal_review for a fully-interpreted multi-upload activity with no linkage result yet", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        interpretationAcknowledgedAt: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-1.csv",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-2.csv",
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
      {
        id: "result-2",
        uploadMetadataId: "upload-2",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, { activityId: "activity-1", stage: "goal_review" });
});

test("getActivityWorkflowStage keeps a multi-upload activity in goal_review while weak linkage proposals are still pending", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        interpretationAcknowledgedAt: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-1.csv",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "upload-2.csv",
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
      {
        id: "result-2",
        uploadMetadataId: "upload-2",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () =>
    ({
      id: "linkage-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      status: "needs_review",
      groups: [],
      proposals: [
        {
          proposalId:
            "name_like_column|upload-1:table:schule|upload-2:table:schule",
          uploadMetadataIdA: "upload-1",
          uploadMetadataIdB: "upload-2",
          tableNameA: "table",
          tableNameB: "table",
          columnNameA: "schule",
          columnNameB: "schule",
          matchBasis: "name_like_column",
          confidence: "medium",
          overlapRatio: 1,
        },
      ],
      proposalDecisions: [],
      createdAt: NOW,
      updatedAt: NOW,
    }) as never;

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, { activityId: "activity-1", stage: "goal_review" });
});

test("getActivityWorkflowStage reports no_evidence without querying jobs or results", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    uploads: [],
    results: [],
  });

  let jobsQueried = false;
  deps.processingJobRepository.listByActivity = async () => {
    jobsQueried = true;
    return [];
  };

  const service = new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const record = await service.getActivityWorkflowStage("user-1", "activity-1");

  assert.deepEqual(record, { activityId: "activity-1", stage: "no_evidence" });
  assert.equal(jobsQueried, false);
});

function buildInterpretationService(
  deps: ReturnType<typeof createDependencies>,
) {
  return new InterpretationService(
    deps.uploadMetadataRepository,
    deps.privacySafeRepresentationRepository,
    deps.qualitativeCodingReviewRepository,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );
}

test("answerQuestions answers a batch of questions on one InterpretationResult with a single downstream sync", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        questions: [
          {
            id: "question-1",
            isBlocking: true,
            status: "pending",
            kind: "single_choice",
            options: ["yes", "no"],
          },
          {
            id: "question-2",
            isBlocking: true,
            status: "pending",
            kind: "free_text",
            options: null,
          },
        ],
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  let syncCallCount = 0;
  deps.datasetPreparationService.syncForInterpretationResult = async () => {
    syncCallCount += 1;
    return {
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
    } as never;
  };

  const service = buildInterpretationService(deps);

  const result = await service.answerQuestions("user-1", "result-1", [
    { questionId: "question-1", answeredValue: "yes" },
    { questionId: "question-2", answeredValue: "Looks complete to me." },
  ]);

  assert.equal(syncCallCount, 1);
  assert.equal(result.id, "result-1");
});

test("answerQuestions rejects the whole batch and persists nothing when one answer is not among the question's options", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        questions: [
          {
            id: "question-1",
            isBlocking: true,
            status: "pending",
            kind: "single_choice",
            options: ["yes", "no"],
          },
          {
            id: "question-2",
            isBlocking: true,
            status: "pending",
            kind: "single_choice",
            options: ["ordinal", "nominal"],
          },
        ],
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  const service = buildInterpretationService(deps);

  await assert.rejects(
    () =>
      service.answerQuestions("user-1", "result-1", [
        { questionId: "question-1", answeredValue: "yes" },
        { questionId: "question-2", answeredValue: "some_value_never_offered" },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "interpretation_question_invalid_answer");
      return true;
    },
  );

  const [result] =
    await deps.interpretationResultRepository.findLatestByUploadMetadataIds(
      ["upload-1"],
      {} as never,
    );
  assert.ok(result);
  assert.equal(
    result.questions.find((question) => question.id === "question-1")?.status,
    "pending",
  );
});
