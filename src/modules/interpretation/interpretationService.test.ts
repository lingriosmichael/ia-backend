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
      } | null;
    }>;
  }>;
  deterministicAnalyses?: Array<{
    id: string;
    interpretationResultId: string;
    uploadMetadataId: string;
    activityId: string;
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
          metrics: [],
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
          metrics: [],
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
            label: "Verteilung der Empfehlungen",
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
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    insights: Array<{
      text: string;
      isGoalRelevant: boolean;
      activityName?: string | null;
    }>;
  }) => {
    summarizedInsights = input.insights;
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

  assert.deepEqual(
    knowledge.insights.map((insight) => insight.sourceType),
    ["indicator", "distribution_signal"],
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
      {
        text: "Verteilung der Empfehlungen: die größten Anteile entfallen auf geeignet 60 % (12), gefolgt von bedingt geeignet 30 % (6).",
        isGoalRelevant: false,
      },
    ],
  );
});

test("activity AI knowledge surfaces linkage contradictions and coverage issues ahead of other insights", async () => {
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
  let capturedContradictions: Array<{
    entityName: string;
    fieldOrTopic: string;
    valueA: string;
    sourceA: string;
    valueB: string;
    sourceB: string;
  }> = [];
  let capturedCoverageIssues: Array<{
    cohortLabel: string;
    cohortSize: number;
    flagLabel: string;
    flagCount: number;
    flagShare: number;
  }> = [];
  deps.pythonProcessingClient.generateAiKnowledgeSummary = async (input: {
    insights: Array<{ text: string; isGoalRelevant: boolean }>;
    indicators?: Array<{ label: string }>;
    contradictions?: Array<{
      entityName: string;
      fieldOrTopic: string;
      valueA: string;
      sourceA: string;
      valueB: string;
      sourceB: string;
    }>;
    coverageIssues?: Array<{
      cohortLabel: string;
      cohortSize: number;
      flagLabel: string;
      flagCount: number;
      flagShare: number;
    }>;
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

  assert.deepEqual(
    knowledge.insights.map((insight) => insight.sourceType),
    [
      "linkage_coverage_issue",
      "linkage_contradiction",
      "indicator",
      "distribution_signal",
    ],
  );

  const coverageInsight = knowledge.insights.find(
    (insight) => insight.sourceType === "linkage_coverage_issue",
  );
  assert.match(coverageInsight?.text ?? "", /1 von 1 Einträgen/);

  const contradictionInsight = knowledge.insights.find(
    (insight) => insight.sourceType === "linkage_contradiction",
  );
  assert.match(contradictionInsight?.text ?? "", /b003/);
  assert.match(contradictionInsight?.text ?? "", /yasmin koch/);
  assert.match(contradictionInsight?.text ?? "", /yasmin koc/);

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

  // No computedValue on the fixture indicator means there is nothing to
  // ground a number/target against, so it must not appear here even
  // though matchesStatedGoal is true.
  assert.deepEqual(capturedIndicators, []);

  assert.deepEqual(capturedContradictions, [
    {
      entityName: "b003",
      fieldOrTopic: "name",
      valueA: "yasmin koch",
      sourceA: "matrix",
      valueB: "yasmin koc",
      sourceB: "safeguarding",
    },
  ]);

  assert.deepEqual(capturedCoverageIssues, [
    {
      cohortLabel: "empfehlung: geeignet",
      cohortSize: 1,
      flagLabel: "remark",
      flagCount: 1,
      flagShare: 1,
    },
  ]);
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
      target: 65,
      metGoal: "false",
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
