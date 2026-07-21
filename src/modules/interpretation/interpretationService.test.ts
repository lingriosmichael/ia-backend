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
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import type { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function createDependencies(options: {
  buildForProject: () => Promise<unknown>;
  generatedSummaryText?: string;
  activities?: Array<{
    id: string;
    projectId: string;
    name: string;
    objectives?: string | null;
    successIndicators?: string | null;
    interpretationAcknowledgedAt: Date | null;
  }>;
  uploads?: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    activityId: string;
  }>;
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
        | "activity_success_indicator"
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
      successIndicators: "strong attendance",
      interpretationAcknowledgedAt: NOW,
    },
  ];
  const uploads = options.uploads ?? [
    {
      id: "upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
    },
  ];
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
    listByActivity: async () => [],
  } as unknown as ProcessingJobRepository;

  const activityRepository = {
    listByProject: async (projectId: string) =>
      activities.filter((activity) => activity.projectId === projectId),
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
  );

  const activity = await service.acknowledgeReview("user-1", "activity-1");

  assert.equal(activity.id, "activity-1");
});

test("activity AI knowledge includes goal indicators and deterministic distribution signals", async () => {
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
