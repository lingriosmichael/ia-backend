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
    outcome?: string | null;
    interpretationAcknowledgedAt: Date | null;
    aiKnowledgeSnapshot?: {
      generatedAt: Date;
    } | null;
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
    updatedAt?: Date;
    questions?: Array<{
      id: string;
      isBlocking: boolean;
      status: "pending" | "answered";
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
      outcome: "strong attendance",
      interpretationAcknowledgedAt: NOW,
      aiKnowledgeSnapshot: null,
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
  const results = options.results ?? [
    {
      id: "result-1",
      uploadMetadataId: "upload-1",
      activityId: "activity-1",
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

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      results
        .filter((result) => uploadMetadataIds.includes(result.uploadMetadataId))
        .map((result) => ({
          qualitativeFindings: [],
          goalAlignment: [],
          indicators: [],
          questions: [],
          updatedAt: NOW,
          ...result,
        })),
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
        aiKnowledgeSnapshot?: unknown;
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
      aiKnowledgeSnapshot: input.aiKnowledgeSnapshot ?? null,
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

test("activity AI knowledge includes goal indicators and deterministic distribution signals", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        // References the distribution's own aiMeaning label ("Empfehlung
        // zur Eignung") so this activity's guaranteed distribution passes
        // the render-gate below — this test is about computation
        // correctness, not relevance, so the fixture must be relevant.
        output: "Anteil geeigneter Mentor:innen laut Empfehlung",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "Anteil Mentor:innen mit klarem Rollenverständnis",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "outcome",
          },
        ],
        entities: [
          {
            originalField: "recommendation",
            aiMeaning: "Empfehlung zur Eignung",
          },
        ],
      },
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        distributions: [
          {
            distributionKey: "recommendation_distribution",
            label: "Distribution of recommendation",
            tableName: "table-1",
            columnName: "recommendation",
            buckets: [
              { value: "geeignet", count: 12, ratio: 0.6 },
              { value: "bedingt geeignet", count: 6, ratio: 0.3 },
              { value: "nicht geeignet", count: 2, ratio: 0.1 },
            ],
          },
        ],
      },
    ],
  });
  let summarizedInsights: Array<{
    text: string;
    isGoalRelevant: boolean;
    activityName?: string | null;
  }> = [];
  let capturedDistributions: Array<{ label: string; summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    insights: Array<{
      text: string;
      isGoalRelevant: boolean;
      activityName?: string | null;
    }>;
    distributions?: Array<{ label: string; summaryText: string }>;
  }) => {
    summarizedInsights = input.insights;
    capturedDistributions = input.distributions ?? [];
    return {
      summaryText:
        "Die Aktivität zeigt zielrelevante Mentor:innen-Indikatoren und eine klare Empfehlungsverteilung.",
    };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const knowledge = await service.generateActivityAiKnowledge(
    "user-1",
    "activity-1",
    "de",
  );

  // The distribution's full category breakdown is now a guaranteed
  // AiKnowledgeDistributionInput, not a discretionary insight competing
  // with the indicator for a capped "weave at most two" slot.
  assert.deepEqual(
    knowledge.insights.map((insight) => insight.sourceType),
    ["indicator"],
  );
  assert.deepEqual(
    summarizedInsights.map((insight) => ({
      text: insight.text,
      isGoalRelevant: insight.isGoalRelevant,
    })),
    [
      {
        text: "Anteil Mentor:innen mit klarem Rollenverständnis.",
        isGoalRelevant: true,
      },
    ],
  );
  // The label comes from the persisted semantic-interpretation aiMeaning,
  // never the raw "Distribution of <column>" placeholder deterministicAnalysisService.ts
  // stores internally — that placeholder must never reach the user now that
  // distribution bullets are rendered entirely in code, with no LLM
  // rephrase step left to catch it.
  assert.deepEqual(capturedDistributions, [
    {
      label: "Empfehlung zur Eignung",
      summaryText:
        "die größten Anteile entfallen auf geeignet 60 % (12), gefolgt von bedingt geeignet 30 % (6), gefolgt von nicht geeignet 10 % (2)",
    },
  ]);
});

test("activity AI knowledge names an explicit remainder instead of silently dropping buckets past the summarized cap", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        // References the distribution field's own fallback label
        // ("Safeguarding check", humanized from its raw column name — no
        // aiMeaning is set on this fixture's result) so it passes the
        // render-gate below; this test is about the remainder-naming
        // behavior, not relevance.
        output: "Two orientation sessions run",
        outcome: "Safeguarding check completed for every applicant",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        distributions: [
          {
            distributionKey: "safeguarding_distribution",
            label: "Verteilung Sicherheitscheck",
            tableName: "table-1",
            columnName: "safeguarding_check",
            buckets: [
              { value: "ok", count: 39, ratio: 0.5 },
              { value: "unbekannt", count: 15, ratio: 0.192 },
              { value: "ruecksprache noetig", count: 10, ratio: 0.128 },
              { value: "in pruefung", count: 8, ratio: 0.103 },
              { value: "abgelehnt", count: 6, ratio: 0.077 },
            ],
          },
        ],
      },
    ],
  });

  let capturedDistributions: Array<{ label: string; summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string; summaryText: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedDistributions.length, 1);
  const [distribution] = capturedDistributions;
  assert.ok(distribution);
  // The 5th bucket ("abgelehnt", 6 records) is past the 4-entry cap — it
  // must still be named as an explicit remainder, not silently dropped.
  assert.match(distribution.summaryText, /1 weitere Kategorien \(6 Einträge\)/);
  assert.doesNotMatch(distribution.summaryText, /abgelehnt/);
});

test("activity AI knowledge computes a joined upload's distribution from the joined entity table, not that upload's own raw per-file total, and never both", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        // References both distribution fields' own fallback labels
        // ("Fuehrungszeugnis status", "Bevorzugte themen") so both pass
        // the render-gate below — this test is about which table each
        // distribution is computed against, not relevance.
        output: "Führungszeugnis für alle Mentor:innen vorlegen",
        outcome: "Bevorzugte Themen der Jugendlichen berücksichtigen",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-matrix",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-csv",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
      },
      {
        id: "upload-unlinked",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "standalone.csv",
      },
    ],
    results: [
      {
        id: "result-matrix",
        uploadMetadataId: "upload-matrix",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
      {
        id: "result-csv",
        uploadMetadataId: "upload-csv",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
      {
        id: "result-unlinked",
        uploadMetadataId: "upload-unlinked",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [],
      },
    ],
    deterministicAnalyses: [
      // The CSV file's own per-file analysis disagrees with the joined
      // table on purpose — this is the exact shape of the reported bug:
      // "ja"/"nein" summed to the CSV file's raw row count (6) here, but
      // only 4 of those rows actually resolved to real, deduplicated
      // entities once joined with the matrix file below.
      {
        id: "analysis-csv",
        interpretationResultId: "result-csv",
        uploadMetadataId: "upload-csv",
        activityId: "activity-1",
        distributions: [
          {
            distributionKey: "fuehrungszeugnis_status_distribution",
            label: "Distribution of fuehrungszeugnis_status",
            tableName: "safeguarding",
            columnName: "fuehrungszeugnis_status",
            buckets: [
              { value: "ja", count: 4, ratio: 4 / 6 },
              { value: "nein", count: 2, ratio: 2 / 6 },
            ],
          },
        ],
      },
      // The unlinked file never joins with anything, so its own per-file
      // distribution has no joined table to be computed against and must
      // still reach the summary via the fallback path.
      {
        id: "analysis-unlinked",
        interpretationResultId: "result-unlinked",
        uploadMetadataId: "upload-unlinked",
        activityId: "activity-1",
        distributions: [
          {
            distributionKey: "mentee_topic_distribution",
            label: "Distribution of bevorzugte_themen",
            tableName: "standalone",
            columnName: "bevorzugte_themen",
            buckets: [
              { value: "sport", count: 3, ratio: 0.6 },
              { value: "kunst", count: 2, ratio: 0.4 },
            ],
          },
        ],
      },
    ],
  });

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-csv", "upload-matrix"],
        // Only 4 real entities once joined — the same "ja"/"nein" field
        // resolves to 3/1 here, not the CSV file's own 4/2.
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-csv", "upload-matrix"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "ja",
                role: "subgroup",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-csv",
                sourceTableName: "safeguarding",
              },
            ],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-csv", "upload-matrix"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "ja",
                role: "subgroup",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-csv",
                sourceTableName: "safeguarding",
              },
            ],
          },
          {
            entityKey: "b003",
            sourceUploadMetadataIds: ["upload-csv", "upload-matrix"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "nein",
                role: "subgroup",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-csv",
                sourceTableName: "safeguarding",
              },
            ],
          },
          {
            entityKey: "b004",
            sourceUploadMetadataIds: ["upload-csv", "upload-matrix"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "ja",
                role: "subgroup",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-csv",
                sourceTableName: "safeguarding",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        // fuehrungszeugnis_status carries its own positive-value
        // definition — this is what makes it a candidate the render-gate
        // can actually resolve against the "Führungszeugnis" goal text
        // above, rather than an independent text match against its own
        // label/values.
        positiveStatusFieldDefinitions: [
          {
            fieldName: "fuehrungszeugnis_status",
            positiveStatusValues: ["bestaetigt"],
            sourceUploadMetadataId: "upload-csv",
            sourceTableName: "safeguarding",
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedDistributions: Array<{ label: string; summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string; summaryText: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  // Exactly one distribution for the joined field (never both the joined
  // and the per-file version), plus the unlinked file's own distribution.
  assert.equal(capturedDistributions.length, 2);

  const joinedDistribution = capturedDistributions.find((distribution) =>
    distribution.summaryText.includes("ja"),
  );
  assert.ok(joinedDistribution);
  // 3 ja / 1 nein from the joined table, not the CSV file's own 4 ja / 2 nein.
  assert.match(joinedDistribution.summaryText, /ja 75 % \(3\)/);
  assert.doesNotMatch(joinedDistribution.summaryText, /\(4\)/);
  assert.doesNotMatch(joinedDistribution.summaryText, /\(2\)/);

  const unlinkedDistribution = capturedDistributions.find((distribution) =>
    distribution.summaryText.includes("sport"),
  );
  assert.ok(unlinkedDistribution);
  assert.match(unlinkedDistribution.summaryText, /sport 60 % \(3\)/);
});

test("activity AI knowledge never surfaces a subgroup breakdown for a field no goal cares about, even though it is still computed", async () => {
  // The reported bloat: a mentee topic-preference breakdown and an
  // experience-level breakdown are both real, correctly-computed
  // subgroup analyses, but neither answers either stated goal — they
  // must not compete for attention with the indicator that does.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "65 geeignete Mentor:innen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "geeignet count",
            confidence: 0.9,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 20,
              recordsIncluded: 75,
              recordsExcluded: 0,
              components: {},
            },
          },
        ],
      },
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        subgroupBreakdowns: [
          {
            breakdownKey: "bevorzugte_themen_breakdown",
            label: "Breakdown by bevorzugte_themen",
            tableName: "table-1",
            columnName: "bevorzugte_themen",
            segments: [
              {
                value: "sport",
                rowCount: 40,
                positiveCount: 8,
                positiveRatio: 0.2,
              },
              {
                value: "kunst",
                rowCount: 35,
                positiveCount: 5,
                positiveRatio: 0.14,
              },
            ],
          },
        ],
      },
    ],
  });

  let summarizedInsights: Array<{ text: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    insights: Array<{ text: string }>;
  }) => {
    summarizedInsights = input.insights;
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const knowledge = await service.generateActivityAiKnowledge(
    "user-1",
    "activity-1",
    "de",
  );

  assert.deepEqual(
    knowledge.insights.map((insight) => insight.sourceType),
    ["indicator"],
  );
  assert.deepEqual(
    summarizedInsights.map((insight) => insight.text),
    knowledge.insights.map((insight) => insight.text),
  );
});

test("activity AI knowledge never surfaces a guaranteed distribution for a field no goal, contradiction, or coverage record cares about", async () => {
  // The regression this fix targets directly: Fix #1 made every column's
  // distribution guaranteed, but nothing gated *surfacing* it — a home
  // district or a job-title breakdown rendered as a top-level bullet with
  // the same weight as the number that actually answers the stated goal.
  // The gate only applies to joined fields (see buildAiKnowledgeDistributionInputs's
  // own comment on why an unlinked upload's distributions are exempt), so
  // this specifically exercises the joined path with a field that has no
  // positive-value definition, feeds no conflict, and shares no vocabulary
  // with either stated goal.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "65 geeignete Mentor:innen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "wohnbezirk",
                value: "Mitte",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "wohnbezirk",
                value: "Nord",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        // No positive-value definition for wohnbezirk — it never becomes
        // a goal-mapping candidate or a coverage-record flag field.
        positiveStatusFieldDefinitions: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedDistributions: Array<{ label: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedDistributions, []);
});

test("activity AI knowledge does not surface a joined field merely because its label shares ordinary vocabulary with the goal text", async () => {
  // The exact reported false positive: a goal mentioning availability
  // ("verfügbar") coincidentally shares a word with a field labeled
  // "Zeitliche Verfügbarkeit" — but nothing actually resolved that field
  // against the goal through the mapping mechanism, a contradiction, or
  // a coverage record. A standalone text match against the field's own
  // label used to let this through; membership in the already-resolved
  // set must not.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "65 geeignete Mentor:innen",
        // Contains "zeitliche" verbatim — the same word the field's own
        // label uses below — so the old, standalone label-word text match
        // would have matched this. Nothing in this fixture resolves the
        // field through the mapping mechanism, a contradiction, or a
        // coverage record, so it must still stay unmatched.
        outcome: "Mentor:innen zeigen zeitliche Verfügbarkeit für ihre Aufgabe",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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
        entities: [
          {
            originalField: "verfuegbarkeit",
            aiMeaning: "Zeitliche Verfügbarkeit",
          },
        ],
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "verfuegbarkeit",
                value: "flexibel",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "verfuegbarkeit",
                value: "eingeschraenkt",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        // No positive-value definition — this field was never resolved
        // through the mapping mechanism, no matter what its label says.
        positiveStatusFieldDefinitions: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedDistributions: Array<{ label: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedDistributions, []);
});

test("activity AI knowledge always surfaces an unlinked upload's own distributions, since no mapping/contradiction/coverage mechanism exists to gate them against", async () => {
  // The render-gate only applies to joined fields — an unlinked upload
  // has no cross-file mapping, contradiction, or coverage-record
  // mechanism to check membership against at all, and the reported bloat
  // has only ever been about multi-file activities. This keeps the
  // pre-gate behavior for the single-upload case unconditionally.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "65 geeignete Mentor:innen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        distributions: [
          {
            distributionKey: "wohnbezirk_distribution",
            label: "Distribution of wohnbezirk",
            tableName: "table-1",
            columnName: "wohnbezirk",
            buckets: [
              { value: "Mitte", count: 30, ratio: 0.4 },
              { value: "Nord", count: 25, ratio: 0.33 },
              { value: "Sued", count: 20, ratio: 0.27 },
            ],
          },
        ],
      },
    ],
  });

  let capturedDistributions: Array<{ label: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedDistributions.length, 1);
  assert.equal(capturedDistributions[0]?.label, "Wohnbezirk");
});

test("activity AI knowledge keeps a direct-identifier column out entirely when its only relevance signal is a linkage conflict", async () => {
  // A contact-info column may appear in linkage diagnostics, but that
  // alone must not promote it into AI knowledge. Direct identifiers now
  // stay out of user-facing distributions entirely unless a later
  // materiality layer proves they affect a real conclusion.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "email_adresse",
                value: "anna.berg@example.com",
                role: "other" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "email_adresse",
                value: "bernd.fischer@example.com",
                role: "other" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        // email_adresse appears in a Tier B conflict, but direct
        // identifiers are now diagnostic-only and must not become AI
        // knowledge distributions on that basis.
        conflicts: [
          {
            entityKey: "b003",
            fieldName: "email_adresse",
            competingValues: [
              {
                value: "carla.klein@example.com",
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
              {
                value: "c.klein@example.com",
                sourceUploadMetadataId: "upload-2",
                sourceTableName: "safeguarding",
              },
            ],
            resolvedValue: "carla.klein@example.com",
          },
        ],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedDistributions: Array<{ label: string; summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    distributions?: Array<{ label: string; summaryText: string }>;
  }) => {
    capturedDistributions = input.distributions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedDistributions, []);
});

test("activity AI knowledge keeps an unmatched compliance status field out of activity indicators when the LLM synthesis stage didn't select it", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        // No indicator references the fuehrungszeugnis_status metric —
        // this is the exact shape of the regression: the LLM synthesis
        // stage simply didn't pick it this run.
        indicators: [],
      },
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        metrics: [
          {
            metricKey: "safeguarding::positive_status_ratio",
            label: "fuehrungszeugnis_status positive ratio",
            description: "Share of rows confirmed clear",
            tableName: "safeguarding",
            sourceColumns: ["fuehrungszeugnis_status"],
            kind: "ratio",
            formula:
              "COUNT(fuehrungszeugnis_status IN {bestaetigt}) / COUNT(rows)",
            value: 0,
            unit: "ratio",
            components: { numeratorCount: 0, denominatorCount: 75 },
          },
        ],
      },
    ],
  });

  let capturedIndicators: Array<{
    label: string;
    value: number;
    denominator: number | null;
    metGoal: string;
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{
      label: string;
      value: number;
      denominator: number | null;
      metGoal: string;
    }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedIndicators, []);
});

test("activity AI knowledge does not duplicate a compliance status indicator the LLM synthesis stage already selected", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [
          {
            id: "indicator-1",
            name: "fuehrungszeugnis_status positive ratio",
            confidence: 0.9,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 0,
              recordsIncluded: 0,
              recordsExcluded: 75,
              components: {
                deterministicAnalysisMetricKey:
                  "safeguarding::positive_status_ratio",
              },
            },
          },
        ],
      },
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        interpretationResultId: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        metrics: [
          {
            metricKey: "safeguarding::positive_status_ratio",
            label: "fuehrungszeugnis_status positive ratio",
            description: "Share of rows confirmed clear",
            tableName: "safeguarding",
            sourceColumns: ["fuehrungszeugnis_status"],
            kind: "ratio",
            formula:
              "COUNT(fuehrungszeugnis_status IN {bestaetigt}) / COUNT(rows)",
            value: 0,
            unit: "ratio",
            components: { numeratorCount: 0, denominatorCount: 75 },
          },
        ],
      },
    ],
  });

  let capturedIndicators: Array<{ label: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{ label: string }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedIndicators.length, 1);
});

test("activity AI knowledge matches a numeric goal to the joined field its own wording names, instead of reporting no structured count", async () => {
  // The exact reported self-contradiction: the goal names "geeignete
  // Mentor:innen" and a correctly-computed distribution for empfehlung ==
  // geeignet sits right there in the same summary, but nothing previously
  // connected the two, so the goal's own verdict text said no structured
  // count existed for it at all. The output field also carries an
  // unrelated, earlier goal statement with its own number (70) — the real
  // reported shape — to confirm the match resolves against empfehlung's
  // own statement (65), never the applications statement that happens to
  // appear first in the same field.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output:
          "Mindestens 70 Bewerbungen von interessierten Mentor:innen sammeln\n65 geeignete Mentor:innen auswählen",
        outcome: null,
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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
        entities: [{ originalField: "empfehlung", aiMeaning: "Empfehlung" }],
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          // 20 of 75 marked "geeignet" — well under half of the target
          // (65), so the numeric verdict must resolve to not_achieved.
          ...Array.from({ length: 20 }, (_, index) => ({
            entityKey: `geeignet-${index}`,
            sourceUploadMetadataIds: ["upload-1"],
            fields: [
              {
                fieldName: "empfehlung",
                value: "geeignet",
                role: "primary_status" as const,
                isPositiveStatusField: true,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          })),
          ...Array.from({ length: 55 }, (_, index) => ({
            entityKey: `nicht-geeignet-${index}`,
            sourceUploadMetadataIds: ["upload-1"],
            fields: [
              {
                fieldName: "empfehlung",
                value: "nicht geeignet",
                role: "primary_status" as const,
                isPositiveStatusField: true,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          })),
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [
          {
            fieldName: "empfehlung",
            positiveStatusValues: ["geeignet"],
            sourceUploadMetadataId: "upload-1",
            sourceTableName: "matrix",
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedIndicators: Array<{
    label: string;
    value: number;
    denominator: number | null;
    target: number | null;
    metGoal: string;
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{
      label: string;
      value: number;
      denominator: number | null;
      target: number | null;
      metGoal: string;
    }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedIndicators.length, 1);
  const [indicator] = capturedIndicators;
  assert.ok(indicator);
  assert.equal(indicator.value, 20);
  assert.equal(indicator.denominator, 75);
  assert.equal(indicator.target, 65);
  assert.equal(indicator.metGoal, "false");
});

test("activity AI knowledge reports a completion-style goal as not met when its matched field's positive count is confirmed zero, instead of unverifiable", async () => {
  // The other reported symptom: a goal phrased as "for all selected
  // candidates," with no explicit number, whose matched field's full
  // distribution already shows zero occurrences of its own positive
  // value — that is a real, checkable failure, not missing data.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: null,
        outcome: "Führungszeugnis für alle Ausgewählte",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-2"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "ausstehend",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-2",
                sourceTableName: "safeguarding",
              },
            ],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-2"],
            fields: [
              {
                fieldName: "fuehrungszeugnis_status",
                value: "abgelehnt",
                role: "subgroup" as const,
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-2",
                sourceTableName: "safeguarding",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [
          {
            fieldName: "fuehrungszeugnis_status",
            positiveStatusValues: ["bestaetigt"],
            sourceUploadMetadataId: "upload-2",
            sourceTableName: "safeguarding",
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedIndicators: Array<{
    label: string;
    value: number;
    target: number | null;
    metGoal: string;
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{
      label: string;
      value: number;
      target: number | null;
      metGoal: string;
    }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedIndicators.length, 1);
  const [indicator] = capturedIndicators;
  assert.ok(indicator);
  assert.equal(indicator.value, 0);
  assert.equal(indicator.target, null);
  assert.equal(indicator.metGoal, "false");
});

test("activity AI knowledge drops a mandatory linkage indicator entirely when no goal text names its field", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1"],
            fields: [
              {
                fieldName: "empfehlung",
                value: "geeignet",
                role: "primary_status" as const,
                isPositiveStatusField: true,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [
          {
            fieldName: "empfehlung",
            positiveStatusValues: ["geeignet"],
            sourceUploadMetadataId: "upload-1",
            sourceTableName: "matrix",
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedIndicators: Array<{ target: number | null; metGoal: string }> =
    [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{ target: number | null; metGoal: string }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedIndicators, []);
});

test("activity AI knowledge keeps direct-identifier conflicts out of AI knowledge while still surfacing relevant coverage issues", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "Anteil Mentor:innen mit klarem Rollenverständnis",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "outcome",
          },
        ],
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

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "empfehlung",
                value: "geeignet",
                role: "primary_status",
                isPositiveStatusField: true,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
              {
                fieldName: "remark",
                value: "pending background check",
                role: "free_text",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-2",
                sourceTableName: "safeguarding",
              },
            ],
          },
          {
            entityKey: "b003",
            sourceUploadMetadataIds: ["upload-1", "upload-2"],
            fields: [
              {
                fieldName: "name",
                value: "yasmin koch",
                role: "free_text",
                isPositiveStatusField: false,
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
            ],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [
          {
            entityKey: "b003",
            fieldName: "name",
            competingValues: [
              {
                value: "yasmin koch",
                sourceUploadMetadataId: "upload-1",
                sourceTableName: "matrix",
              },
              {
                value: "yasmin koc",
                sourceUploadMetadataId: "upload-2",
                sourceTableName: "safeguarding",
              },
            ],
            resolvedValue: "yasmin koch",
          },
        ],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [
          {
            fieldName: "empfehlung",
            positiveStatusValues: ["geeignet"],
            sourceUploadMetadataId: "upload-1",
            sourceTableName: "matrix",
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let summarizedInsights: Array<{ text: string; isGoalRelevant: boolean }> = [];
  let capturedIndicators: Array<{ label: string }> = [];
  let capturedContradictions: Array<{ summaryText: string }> = [];
  let capturedCoverageIssues: Array<{ summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    insights: Array<{ text: string; isGoalRelevant: boolean }>;
    indicators?: Array<{ label: string }>;
    contradictions?: Array<{ summaryText: string }>;
    coverageIssues?: Array<{ summaryText: string }>;
  }) => {
    summarizedInsights = input.insights;
    capturedIndicators = input.indicators ?? [];
    capturedContradictions = input.contradictions ?? [];
    capturedCoverageIssues = input.coverageIssues ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const knowledge = await service.generateActivityAiKnowledge(
    "user-1",
    "activity-1",
    "de",
  );

  // The cross-file crosstab between empfehlung and fuehrungszeugnis_status
  // is still computed (buildLinkageCrossFileCrosstabDrafts runs
  // unconditionally) but never marked isGoalRelevant, so it no longer
  // surfaces as a top-level "distribution_signal" Erkenntnis competing
  // with the coverage issue/indicator that actually answer this
  // activity's goals. The name mismatch remains in linkage diagnostics,
  // but the new field-eligibility gate keeps this direct-identifier
  // conflict out of AI knowledge entirely.
  assert.deepEqual(
    knowledge.insights.map((insight) => insight.sourceType),
    ["linkage_coverage_issue", "indicator"],
  );

  const coverageInsight = knowledge.insights.find(
    (insight) => insight.sourceType === "linkage_coverage_issue",
  );
  assert.match(coverageInsight?.text ?? "", /1 von 1 Einträgen/);

  // The persisted snapshot keeps every insight (for the review UI), but the
  // linkage contradiction/coverage issue text is now also sent structurally
  // below, so it's excluded from the prose insights handed to the LLM to
  // avoid spending its limited "additional insights" allowance repeating
  // facts it already has as JSON.
  assert.deepEqual(
    summarizedInsights.map((insight) => insight.text),
    knowledge.insights
      .filter(
        (insight) =>
          insight.sourceType !== "linkage_contradiction" &&
          insight.sourceType !== "linkage_coverage_issue",
      )
      .map((insight) => insight.text),
  );

  // The LLM-selected indicator itself is dropped (no computedValue to
  // ground a number/target against, even though matchesStatedGoal is
  // true), and the linkage-sourced fallback is now also suppressed
  // because neither goal text ("Two orientation sessions run" / "strong
  // attendance") explicitly names "geeignet" or "empfehlung." The
  // cross-file coverage issue still surfaces below; the name conflict
  // does not, because direct identifiers are now diagnostic-only.
  assert.deepEqual(capturedIndicators, []);

  assert.deepEqual(capturedContradictions, []);

  assert.deepEqual(capturedCoverageIssues, [
    {
      summaryText:
        '1 von 1 Einträgen mit Empfehlung "geeignet" haben bei Remark noch einen offenen oder ungeklärten Stand (100 %).',
    },
  ]);
});

test("activity AI knowledge sends structured outcome assessments for condition-style goals even without a numeric target", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "65 geeignete Mentor:innen",
        outcome:
          "Sicherheitsrelevante Bedenken werden vor Schulungsbeginn identifiziert und geklärt.",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [
          {
            id: "goal-alignment-support",
            goalSummary:
              "Sicherheitsrelevante Bedenken werden vor Schulungsbeginn identifiziert und geklärt.",
            isSupportedByData: true,
            gapExplanation: null,
          },
          {
            id: "goal-alignment-gap",
            goalSummary:
              "Sicherheitsrelevante Bedenken werden vor Schulungsbeginn identifiziert und geklärt.",
            isSupportedByData: false,
            gapExplanation:
              "Bei mehreren geeigneten Kandidat:innen ist die Sicherheitsklärung noch offen.",
          },
        ],
        indicators: [],
      },
    ],
  });

  let capturedOutcomeAssessments: Array<{
    goalText: string;
    evaluationMode:
      | "numeric_target"
      | "condition"
      | "directional_change"
      | "evidence_only";
    assessmentStatus:
      | "achieved"
      | "partially_supported"
      | "not_achieved"
      | "insufficient_evidence";
    supportingEvidence: string[];
    limitingEvidence: string[];
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    outcomeAssessments?: Array<{
      goalText: string;
      evaluationMode:
        | "numeric_target"
        | "condition"
        | "directional_change"
        | "evidence_only";
      assessmentStatus:
        | "achieved"
        | "partially_supported"
        | "not_achieved"
        | "insufficient_evidence";
      supportingEvidence: string[];
      limitingEvidence: string[];
    }>;
  }) => {
    capturedOutcomeAssessments = input.outcomeAssessments ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedOutcomeAssessments, [
    {
      goalText:
        "Sicherheitsrelevante Bedenken werden vor Schulungsbeginn identifiziert und geklärt.",
      evaluationMode: "condition",
      assessmentStatus: "partially_supported",
      supportingEvidence: [
        "Sicherheitsrelevante Bedenken werden vor Schulungsbeginn identifiziert und geklärt.",
      ],
      limitingEvidence: [
        "Bei mehreren geeigneten Kandidat:innen ist die Sicherheitsklärung noch offen.",
      ],
    },
  ]);
});

test("activity AI knowledge still sends every eligible Tier B conflict as its own contradiction, never truncated to just one", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "matrix.xlsx",
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        originalFileName: "safeguarding.csv",
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

  const entityKeys = ["b001", "b002", "b003", "b004", "b005"];
  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: entityKeys.map((entityKey) => ({
          entityKey,
          sourceUploadMetadataIds: ["upload-1", "upload-2"],
          fields: [],
        })),
        duplicateRowsRemoved: [],
        conflicts: entityKeys.map((entityKey) => ({
          entityKey,
          fieldName: "fuehrungszeugnis_status",
          competingValues: [
            {
              value: `${entityKey}-pending`,
              sourceUploadMetadataId: "upload-1",
              sourceTableName: "matrix",
            },
            {
              value: `${entityKey}-ok`,
              sourceUploadMetadataId: "upload-2",
              sourceTableName: "safeguarding",
            },
          ],
          resolvedValue: `${entityKey}-ok`,
        })),
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedContradictions: Array<{ summaryText: string }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    contradictions?: Array<{ summaryText: string }>;
  }) => {
    capturedContradictions = input.contradictions ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedContradictions.length, 5);
  assert.ok(
    capturedContradictions.every((contradiction) =>
      contradiction.summaryText.includes("widersprüchliche Angaben"),
    ),
  );
});

test("activity AI knowledge sends a structured indicator once a goal-matching computed value and a numeric goal target are both present", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "65 geeignete Mentor:innen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "geeignet",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 20,
              recordsIncluded: 20,
              recordsExcluded: 55,
            },
          },
        ],
      },
    ],
  });

  let capturedIndicators: unknown[] = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: unknown[];
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedIndicators, [
    {
      label: "geeignet",
      value: 20,
      denominator: 75,
      denominatorBasis: "not_applicable",
      target: 65,
      metGoal: "false",
    },
  ]);
});

test("activity AI knowledge attaches the target from the goal statement that actually names the indicator, not an unrelated number from a different statement in the same field", async () => {
  // The exact reported bug, reproduced against the real activity's own
  // output text: "Mindestens 70 Bewerbungen..." and "65 geeignete
  // Mentor:innen..." are two distinct Leistungsziele in the same
  // multi-line output field. An indicator named "geeignet" must be
  // checked against target 65 (its own statement), never 70 (the
  // unrelated applications statement that happens to appear first).
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output:
          "Mindestens 70 Bewerbungen von interessierten Mentor:innen sammeln\n65 geeignete Mentor:innen auswählen\nFührungszeugnis-Prüfung für alle ausgewählten Mentor:innen einholen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "geeignet",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 20,
              recordsIncluded: 20,
              recordsExcluded: 55,
            },
          },
        ],
      },
    ],
  });

  let capturedIndicators: Array<{ target: number | null; metGoal: string }> =
    [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{ target: number | null; metGoal: string }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.equal(capturedIndicators.length, 1);
  const [indicator] = capturedIndicators;
  assert.ok(indicator);
  assert.equal(indicator.target, 65);
  assert.notEqual(indicator.target, 70);
});

test("activity AI knowledge marks an indicator's denominator as deduplicated or not, based on whether it actually matches the linked entity count", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "65 geeignete Mentor:innen",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "geeignet (deduplicated)",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 20,
              // 2 + 0 = 2, matching the linkage group's entity count below.
              recordsIncluded: 2,
              recordsExcluded: 0,
            },
          },
        ],
      },
      {
        id: "result-2",
        uploadMetadataId: "upload-2",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [],
        goalAlignment: [],
        indicators: [
          {
            id: "indicator-2",
            name: "fuehrungszeugnis eingereicht (raw, not deduplicated)",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 26,
              // 79, not 2 — this upload's own raw row count disagrees
              // with the linked group's deduplicated entity count.
              recordsIncluded: 79,
              recordsExcluded: 0,
            },
          },
        ],
      },
    ],
  });

  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [
      {
        joinKeyLabel: "bewerbungs_id",
        linkedUploadMetadataIds: ["upload-1", "upload-2"],
        entities: [
          {
            entityKey: "b001",
            sourceUploadMetadataIds: ["upload-1"],
            fields: [],
          },
          {
            entityKey: "b002",
            sourceUploadMetadataIds: ["upload-1"],
            fields: [],
          },
        ],
        duplicateRowsRemoved: [],
        conflicts: [],
        coverageDiffs: [],
        positiveStatusFieldDefinitions: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });

  let capturedIndicators: Array<{ label: string; denominatorBasis: string }> =
    [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{ label: string; denominatorBasis: string }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  const dedupedIndicator = capturedIndicators.find(
    (indicator) => indicator.label === "geeignet (deduplicated)",
  );
  const rawIndicator = capturedIndicators.find(
    (indicator) =>
      indicator.label ===
      "fuehrungszeugnis eingereicht (raw, not deduplicated)",
  );
  assert.ok(dedupedIndicator);
  assert.ok(rawIndicator);
  assert.equal(dedupedIndicator.denominatorBasis, "deduplicated");
  assert.equal(
    rawIndicator.denominatorBasis,
    "not_deduplicated_across_sources",
  );
});

test("activity AI knowledge reports an indicator as unverifiable, not dropped, when its computed value exists but the goal has no extractable target", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Mentor:innen sind gut vorbereitet.",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
        indicators: [
          {
            id: "indicator-1",
            name: "Bewerbungen gesammelt",
            confidence: 0.94,
            status: "kept",
            matchesStatedGoal: true,
            relevanceStage: "output",
            computedValue: {
              value: 75,
              recordsIncluded: 75,
              recordsExcluded: 0,
            },
          },
        ],
      },
    ],
  });

  let capturedIndicators: Array<{
    label: string;
    value: number;
    target: number | null;
    metGoal: string;
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    indicators?: Array<{
      label: string;
      value: number;
      target: number | null;
      metGoal: string;
    }>;
  }) => {
    capturedIndicators = input.indicators ?? [];
    return { summaryText: "summary" };
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await service.generateActivityAiKnowledge("user-1", "activity-1", "de");

  assert.deepEqual(capturedIndicators, [
    {
      label: "Bewerbungen gesammelt",
      value: 75,
      denominator: 75,
      denominatorBasis: "not_applicable",
      target: null,
      metGoal: "unverifiable",
    },
  ]);
});

test("activity AI knowledge falls back to an honest plain-language message, never raw insight text, when the summary call fails", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [
          {
            id: "finding-1",
            summary: "Attendance was strong across sessions.",
            confidence: 0.9,
            status: "kept",
            outcomeAnchorType: "activity_outcome",
            relationToEvidence: "reinforces",
            category: "outcome",
          },
        ],
        goalAlignment: [],
        indicators: [],
      },
    ],
  });

  deps.pythonProcessingClient.generateAiKnowledgeSummary = async () => {
    throw new Error("The Python processing service timed out.");
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const knowledge = await service.generateActivityAiKnowledge(
    "user-1",
    "activity-1",
    "de",
  );

  assert.equal(
    knowledge.summaryText,
    "Für diese Aktivität konnte aktuell keine automatische Zusammenfassung erstellt werden.",
  );
  assert.doesNotMatch(knowledge.summaryText, /Attendance was strong/);
  // The insight itself is still persisted for the review UI — only the
  // user-facing summaryText must never fall back to raw insight text.
  assert.deepEqual(
    knowledge.insights.map((insight) => insight.text),
    ["Attendance was strong across sessions."],
  );
});

test("activity AI knowledge generation is blocked once an activity snapshot already exists", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: NOW,
        aiKnowledgeSnapshot: {
          generatedAt: NOW,
        },
      },
    ],
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await assert.rejects(
    service.generateActivityAiKnowledge("user-1", "activity-1", "de"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "activity_ai_knowledge_already_generated",
      );
      return true;
    },
  );
});

test("regenerateActivityAiKnowledge overwrites an existing snapshot with a freshly built one", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    generatedSummaryText: "Freshly regenerated summary.",
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: NOW,
        aiKnowledgeSnapshot: {
          generatedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      },
    ],
    results: [
      {
        id: "result-1",
        uploadMetadataId: "upload-1",
        activityId: "activity-1",
        updatedAt: NOW,
        qualitativeFindings: [
          {
            id: "finding-1",
            summary: "Attendance was strong across sessions.",
            confidence: 0.9,
            status: "kept",
            outcomeAnchorType: "activity_outcome",
            relationToEvidence: "reinforces",
            category: "outcome",
          },
        ],
        goalAlignment: [],
        indicators: [],
      },
    ],
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  const knowledge = await service.regenerateActivityAiKnowledge(
    "user-1",
    "activity-1",
    "de",
  );

  assert.equal(knowledge.summaryText, "Freshly regenerated summary.");
  assert.notEqual(knowledge.generatedAt, "2025-01-01T00:00:00.000Z");
});

test("regenerateActivityAiKnowledge is blocked when the activity has no AI knowledge to replace yet", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await assert.rejects(
    service.regenerateActivityAiKnowledge("user-1", "activity-1", "de"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "activity_ai_knowledge_not_generated_yet",
      );
      return true;
    },
  );
});

test("activity AI knowledge generation is blocked for a multi-upload activity until evidence linkage has run (§11)", async () => {
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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

  // Default fake already returns null from findByActivityId — reconciliation
  // hasn't produced a record for this activity yet.

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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await assert.rejects(
    service.generateActivityAiKnowledge("user-1", "activity-1", "de"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "activity_ai_knowledge_not_ready",
      );
      return true;
    },
  );
});

test("regenerateActivityAiKnowledge refuses to build a snapshot for an already-acknowledged activity whose evidence no longer has any interpretation results", async () => {
  // The exact reported bug, reproduced: an already-acknowledged activity
  // (computeActivityWorkflowStage's "reviewed" stage short-circuits every
  // other precondition check) whose uploads currently have zero
  // interpretation results — e.g. evidence was removed or reset after the
  // last successful run. Without this check, the stale linkageResult
  // still on file would let a full-looking snapshot get built anyway,
  // reporting "1 insight from 0 evidence files" as if that were a normal
  // result instead of refusing outright.
  const deps = createDependencies({
    buildForProject: async () => ({}),
    activities: [
      {
        id: "activity-1",
        projectId: "project-1",
        name: "Activity",
        objectives: "prepare mentors",
        output: "Two orientation sessions run",
        outcome: "strong attendance",
        interpretationAcknowledgedAt: NOW,
        aiKnowledgeSnapshot: { generatedAt: NOW },
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
    // No results at all for either upload — the exact observed state.
    results: [],
  });

  // A stale linkage record from a prior, successful run still on file —
  // this is what let real-looking content render despite zero results.
  deps.activityEvidenceLinkageResultRepository.findByActivityId = async () => ({
    id: "linkage-result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    groups: [],
    createdAt: NOW,
    updatedAt: NOW,
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
    deps.projectLlmTokenLedgerService,
    deps.evidenceLinkageReconciliationService,
    deps.activityEvidenceLinkageResultRepository,
  );

  await assert.rejects(
    service.regenerateActivityAiKnowledge("user-1", "activity-1", "de"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "activity_ai_knowledge_not_ready",
      );
      return true;
    },
  );
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
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
      },
    ],
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
        outcome: "strong attendance",
        interpretationAcknowledgedAt: null,
        aiKnowledgeSnapshot: null,
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
