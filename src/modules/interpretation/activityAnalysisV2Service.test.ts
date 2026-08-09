import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import { ActivityAnalysisV2Service } from "./activityAnalysisV2Service.js";
import type { ActivityAnalysisV2ToolExecutor } from "./activityAnalysisV2ToolExecutor.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import { CurrentActivityEvidenceLoader } from "./currentActivityEvidenceLoader.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";

const NOW = new Date("2026-08-08T10:00:00.000Z");

function createServiceFixture(options?: {
  uploads?: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    activityId: string;
    logicalEvidenceId: string;
    versionNumber: number;
    originalFileName: string;
    createdAt: Date;
  }>;
  privacySafeRepresentations?: Array<{
    id: string;
    uploadMetadataId: string;
    payload: Record<string, unknown>;
  }>;
  activityOutcome?: string | null;
  activityOutput?: string | null;
  activityAiKnowledgeSnapshot?: {
    generatedAt: Date;
    interpretedEvidenceCount: number;
    totalEvidenceCount: number;
    summaryText: string;
    insights: Array<{ id: string }>;
  } | null;
  plannerResponse?: Record<string, unknown> | Record<string, unknown>[];
  executorResult?: Record<string, unknown>;
}) {
  const uploads = options?.uploads ?? [
    {
      id: "upload-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      logicalEvidenceId: "evidence-1",
      versionNumber: 2,
      originalFileName: "mentors.csv",
      createdAt: NOW,
    },
  ];
  const privacySafeRepresentations = options?.privacySafeRepresentations ?? [
    {
      id: "psr-1",
      uploadMetadataId: "upload-1",
      payload: {
        metadata: {
          evidenceModality: "structured_quantitative",
          interpretationDataType: "tabular_structured",
        },
      },
    },
  ];

  const uploadMetadataRepository = {
    listByActivityIds: async (activityIds: string[]) =>
      uploads.filter((upload) => activityIds.includes(upload.activityId)),
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      privacySafeRepresentations.filter((representation) =>
        uploadMetadataIds.includes(representation.uploadMetadataId),
      ),
  } as unknown as PrivacySafeRepresentationRepository;

  const loader = new CurrentActivityEvidenceLoader(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
  );
  let activityAnalysisV2ClarificationAnswers: Array<Record<string, unknown>> =
    [];
  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      uploadMetadataIds.map((uploadMetadataId, index) => ({
        id: `result-${index + 1}`,
        uploadMetadataId,
      })),
  } as unknown as InterpretationResultRepository;
  const datasetPreparationService = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      interpretationResultIds.map((interpretationResultId) => ({
        interpretationResultId,
        preparedDataset: {
          tables: [
            {
              name: "mentors",
              identifierColumn: "bewerbungs_id",
              identifierHandling: "deduplicate_by_identifier",
              primaryStatusColumn: "status",
              primaryDateColumn: null,
              columns: [
                {
                  name: "bewerbungs_id",
                  role: "identifier",
                  inferredType: "identifier",
                },
                {
                  name: "status",
                  role: "primary_status",
                  inferredType: "categorical",
                },
              ],
            },
          ],
        },
      })),
  } as unknown as DatasetPreparationService;

  const createdRuns: Array<Record<string, unknown>> = [];
  let latestRun: Record<string, unknown> | null = null;
  const activityAnalysisRunV2Repository = {
    create: async (input: Record<string, unknown>) => {
      createdRuns.push(input);
      latestRun = {
        id: "run-1",
        organizationId: input.organizationId,
        projectId: input.projectId,
        activityId: input.activityId,
        activityName: input.activityName,
        phase: input.phase,
        status: input.status,
        goalsSnapshot: input.goalsSnapshot,
        evidence: input.evidence,
        runLimits: input.runLimits,
        clarificationQuestions: input.clarificationQuestions ?? [],
        toolCallTrace: input.toolCallTrace,
        calculations: input.calculations,
        assessment: input.assessment,
        diagnostics: input.diagnostics,
        shadowComparison: input.shadowComparison,
        renderedSummary: input.renderedSummary,
        validation: input.validation,
        errorMessage: input.errorMessage,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return latestRun;
    },
    findLatestByActivityId: async () => latestRun,
  } as unknown as ActivityAnalysisRunV2Repository;
  const activityRepository = {
    update: async (_activityId: string, input: Record<string, unknown>) => {
      activityAnalysisV2ClarificationAnswers =
        (input.activityAnalysisV2ClarificationAnswers as Array<
          Record<string, unknown>
        >) ?? activityAnalysisV2ClarificationAnswers;
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Mentor:innengewinnung und Auswahl",
        description: null,
        activityType: "other",
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        outcome: options?.activityOutcome ?? null,
        concernTaggingInstruction: null,
        status: "completed",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        aiKnowledgeSnapshot: options?.activityAiKnowledgeSnapshot ?? null,
        activityAnalysisV2ClarificationAnswers,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
    upsertClarificationAnswer: async (
      _activityId: string,
      answer: Record<string, unknown>,
    ) => {
      activityAnalysisV2ClarificationAnswers = [
        ...activityAnalysisV2ClarificationAnswers.filter(
          (existing) => existing.questionId !== answer.questionId,
        ),
        answer,
      ];
      return {
        id: "activity-1",
        projectId: "project-1",
        name: "Mentor:innengewinnung und Auswahl",
        description: null,
        activityType: "other",
        startDate: null,
        endDate: null,
        targetAudience: null,
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        outcome: options?.activityOutcome ?? null,
        concernTaggingInstruction: null,
        status: "completed",
        interpretationAcknowledgedAt: null,
        interpretationAcknowledgedById: null,
        aiKnowledgeSnapshot: options?.activityAiKnowledgeSnapshot ?? null,
        activityAnalysisV2ClarificationAnswers,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
  } as unknown as ActivityRepository;

  const authorizationService = {
    canEditActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
        name: "Mentor:innengewinnung und Auswahl",
        activityType: "other",
        objectives: "Mentor:innen gewinnen",
        output: options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
        outcome: options?.activityOutcome ?? null,
        activityAnalysisV2ClarificationAnswers,
        aiKnowledgeSnapshot: options?.activityAiKnowledgeSnapshot ?? {
          generatedAt: NOW,
          interpretedEvidenceCount: 1,
          totalEvidenceCount: 1,
          summaryText: "Ergebnisse\n\nBestehende V1-Zusammenfassung.",
          insights: [{ id: "insight-1" }],
        },
      },
    }),
    canViewActivity: async () => ({
      project: {
        id: "project-1",
        organizationId: "org-1",
      },
      activity: {
        id: "activity-1",
      },
    }),
  } as unknown as AuthorizationService;
  const activityAnalysisV2ToolExecutor = {
    execute: async () =>
      options?.executorResult ?? {
        toolCallTrace: [
          {
            toolCallId: "tool_1_count_distinct",
            toolName: "count_distinct",
            arguments: {
              uploadMetadataId: "upload-1",
              tableName: "mentors",
              columnName: "bewerbungs_id",
              useAnalysisRows: true,
            },
            calculationIds: ["calc_applications_count"],
            status: "succeeded",
            errorMessage: null,
            startedAt: NOW.toISOString(),
            completedAt: NOW.toISOString(),
            durationMs: 0,
          },
          {
            toolCallId: "tool_2_compare_target",
            toolName: "compare_target",
            arguments: {
              valueAlias: "applications_count",
              target: 70,
              comparison: "at_least",
              label: "Applications target",
            },
            calculationIds: ["calc_applications_target"],
            status: "succeeded",
            errorMessage: null,
            startedAt: NOW.toISOString(),
            completedAt: NOW.toISOString(),
            durationMs: 0,
          },
        ],
        calculations: [
          {
            calculationId: "calc_applications_count",
            toolName: "count_distinct",
            label: "Distinct applications",
            description: "Counts unique applications.",
            formula: "COUNT_DISTINCT(bewerbungs_id)",
            value: 75,
            unit: "distinct_values",
            sourceUploadMetadataIds: ["upload-1"],
            sourceTableNames: ["mentors"],
            sourceColumns: ["bewerbungs_id"],
            numerator: 75,
            denominator: null,
            denominatorType: "distinct_entities",
            identifierColumn: "bewerbungs_id",
            result: { distinctCount: 75, basis: "analysis_rows" },
          },
          {
            calculationId: "calc_applications_target",
            toolName: "compare_target",
            label: "Applications target",
            description: "Compares applications against the target.",
            formula: "75 at_least 70",
            value: true,
            unit: null,
            sourceUploadMetadataIds: [],
            sourceTableNames: [],
            sourceColumns: [],
            numerator: 75,
            denominator: 70,
            denominatorType: "rows",
            identifierColumn: null,
            result: {
              achieved: true,
              gap: 5,
              comparison: "at_least",
              value: 75,
              target: 70,
            },
          },
        ],
      },
  } as unknown as ActivityAnalysisV2ToolExecutor;
  let plannerCallCount = 0;
  const pythonProcessingClient = {
    planActivityAnalysisV2: async () => {
      const plannerResponse = Array.isArray(options?.plannerResponse)
        ? (options?.plannerResponse[plannerCallCount] ??
          options?.plannerResponse.at(-1))
        : options?.plannerResponse;
      plannerCallCount += 1;
      return (
        plannerResponse ?? {
          goalPlans: [
            {
              goalId: "output_1",
              goalType: "output",
              goalText:
                options?.activityOutput ?? "Mindestens 70 Bewerbungen sammeln",
              evaluationMode: "numeric_target",
              status: "planned",
              rationale:
                "A distinct application count can be compared to the target.",
              plannedToolNames: ["count_distinct", "compare_target"],
            },
          ],
          clarificationQuestions: [],
          toolRequests: [
            {
              goalId: "output_1",
              alias: "applications_count",
              toolName: "count_distinct",
              arguments: {
                uploadMetadataId: "upload-1",
                tableName: "mentors",
                columnName: "bewerbungs_id",
                useAnalysisRows: true,
              },
            },
            {
              goalId: "output_1",
              toolName: "compare_target",
              arguments: {
                valueAlias: "applications_count",
                target: 70,
                comparison: "at_least",
                label: "Applications target",
              },
            },
          ],
          limitations: [],
          validation: {
            status: "passed",
            issues: [],
          },
        }
      );
    },
  } as unknown as PythonProcessingClient;
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  const service = new ActivityAnalysisV2Service(
    authorizationService,
    activityRepository,
    loader,
    activityAnalysisRunV2Repository,
    activityAnalysisV2ToolExecutor,
    interpretationResultRepository,
    datasetPreparationService,
    pythonProcessingClient,
    logger as never,
  );

  return {
    service,
    createdRuns,
    getActivityAnalysisV2ClarificationAnswers: () =>
      activityAnalysisV2ClarificationAnswers,
  };
}

test("previewActivityAnalysis persists a separate shadow run with current evidence", async () => {
  const fixture = createServiceFixture();

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.analysisRunId, "run-1");
  assert.equal(record.status, "completed");
  assert.equal(record.phase, "phase_4_rendering");
  assert.equal(record.activityName, "Mentor:innengewinnung und Auswahl");
  assert.equal(
    record.goalsSnapshot.output,
    "Mindestens 70 Bewerbungen sammeln",
  );
  assert.equal(record.evidence.length, 1);
  assert.equal(record.evidence[0]?.uploadMetadataId, "upload-1");
  assert.equal(record.evidence[0]?.privacySafeRepresentationId, "psr-1");
  assert.equal(record.evidence[0]?.logicalEvidenceId, "evidence-1");
  assert.equal(record.toolCallTrace.length, 2);
  assert.equal(record.toolCallTrace[0]?.toolName, "count_distinct");
  assert.equal(record.toolCallTrace[1]?.toolName, "compare_target");
  assert.equal(record.calculations.length, 2);
  assert.equal(
    record.calculations[0]?.calculationId,
    "calc_applications_count",
  );
  assert.equal(
    record.calculations[1]?.calculationId,
    "calc_applications_target",
  );
  assert.equal(record.validation.status, "passed");
  assert.ok(record.assessment);
  assert.equal(record.assessment?.goalAssessments.length, 1);
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "achieved",
  );
  assert.equal(record.diagnostics.goalCount, 1);
  assert.equal(record.diagnostics.executedToolCallCount, 2);
  assert.equal(record.shadowComparison.status, "shadow_ready");
  assert.equal(record.shadowComparison.noOutcomeSectionOmitted, true);
  assert.equal(
    record.renderedSummary,
    "Ergebnisse\n\nMindestens 70 Bewerbungen sammeln: Gemessener Wert 75 bei Ziel 70. Dieses Ziel ist erreicht.",
  );
  assert.equal(record.renderedSummary?.includes("Wirkung"), false);
  assert.equal(fixture.createdRuns.length, 1);
});

test("previewActivityAnalysis pauses and persists clarification questions when the planner requests them", async () => {
  const fixture = createServiceFixture({
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_clarification",
          rationale:
            "The planner needs the operational status definition first.",
          plannedToolNames: [],
          missingCapabilities: [],
        },
      ],
      clarificationQuestions: [
        {
          goalId: "output_1",
          prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
          kind: "single_choice",
          questionDomain: "interpretation",
          options: ["status", "entscheidung"],
          recommendedOption: "status",
          recommendedConfidence: 0.91,
          isBlocking: true,
          questionCode: "primary_status_field",
          targetTableName: "mentors",
          targetColumnName: null,
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "needs_clarification");
  assert.equal(record.clarificationQuestions.length, 1);
  assert.equal(record.clarificationQuestions[0]?.goalId, "output_1");
  assert.equal(record.clarificationQuestions[0]?.status, "pending");
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);
  assert.equal(record.renderedSummary, null);
});

test("answerClarificationQuestion persists the answer and reruns analysis", async () => {
  const fixture = createServiceFixture({
    plannerResponse: [
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "requires_clarification",
            rationale:
              "The planner needs the operational status definition first.",
            plannedToolNames: [],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [
          {
            goalId: "output_1",
            prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
            kind: "single_choice",
            questionDomain: "interpretation",
            options: ["status", "entscheidung"],
            recommendedOption: "status",
            recommendedConfidence: 0.91,
            isBlocking: true,
            questionCode: "primary_status_field",
            targetTableName: "mentors",
            targetColumnName: null,
          },
        ],
        toolRequests: [],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "planned",
            rationale:
              "A distinct application count can be compared to the target.",
            plannedToolNames: ["count_distinct", "compare_target"],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [],
        toolRequests: [
          {
            goalId: "output_1",
            alias: "applications_count",
            toolName: "count_distinct",
            arguments: {
              uploadMetadataId: "upload-1",
              tableName: "mentors",
              columnName: "bewerbungs_id",
              useAnalysisRows: true,
            },
          },
          {
            goalId: "output_1",
            toolName: "compare_target",
            arguments: {
              valueAlias: "applications_count",
              target: 70,
              comparison: "at_least",
              label: "Applications target",
            },
          },
        ],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
    ],
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const questionId = initialRun.clarificationQuestions[0]?.id;
  assert.ok(questionId);

  const resumedRun = await fixture.service.answerClarificationQuestion(
    "user-1",
    "activity-1",
    questionId!,
    "status",
  );

  assert.equal(resumedRun.status, "completed");
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 1);
  assert.equal(
    fixture.getActivityAnalysisV2ClarificationAnswers()[0]?.questionId,
    questionId,
  );
});

test("answerClarificationQuestion rejects an answer that isn't one of the question's offered options", async () => {
  const fixture = createServiceFixture({
    plannerResponse: [
      {
        goalPlans: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            evaluationMode: "numeric_target",
            status: "requires_clarification",
            rationale:
              "The planner needs the operational status definition first.",
            plannedToolNames: [],
            missingCapabilities: [],
          },
        ],
        clarificationQuestions: [
          {
            goalId: "output_1",
            prompt: "Welches Feld definiert den finalen Bewerbungsstatus?",
            kind: "single_choice",
            questionDomain: "interpretation",
            options: ["status", "entscheidung"],
            recommendedOption: "status",
            recommendedConfidence: 0.91,
            isBlocking: true,
            questionCode: "primary_status_field",
            targetTableName: "mentors",
            targetColumnName: null,
          },
        ],
        toolRequests: [],
        limitations: [],
        validation: {
          status: "passed",
          issues: [],
        },
      },
    ],
  });

  const initialRun = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );
  const questionId = initialRun.clarificationQuestions[0]?.id;
  assert.ok(questionId);

  await assert.rejects(
    () =>
      fixture.service.answerClarificationQuestion(
        "user-1",
        "activity-1",
        questionId!,
        // Not one of ["status", "entscheidung"] — a single_choice question
        // must only accept its offered options.
        "some_other_value_the_ui_never_offered",
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "activity_analysis_v2_question_invalid_answer");
      assert.equal(error.statusCode, 422);
      return true;
    },
  );
  // The rejected answer must not have been persisted.
  assert.equal(fixture.getActivityAnalysisV2ClarificationAnswers().length, 0);
});

test("getLatestActivityAnalysis returns the latest persisted shadow run", async () => {
  const fixture = createServiceFixture();

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");
  const record = await fixture.service.getLatestActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.analysisRunId, "run-1");
  assert.equal(record.shadowComparison.status, "shadow_ready");
});

test("legacy AI knowledge compatibility view is mapped from the latest V2 run", async () => {
  const fixture = createServiceFixture();

  await fixture.service.previewActivityAnalysis("user-1", "activity-1");
  const record = await fixture.service.getLegacyActivityAiKnowledge(
    "user-1",
    "activity-1",
  );

  assert.equal(record.activityId, "activity-1");
  assert.equal(record.projectId, "project-1");
  assert.equal(record.activityName, "Mentor:innengewinnung und Auswahl");
  assert.equal(record.interpretedEvidenceCount, 1);
  assert.equal(record.totalEvidenceCount, 1);
  assert.equal(
    record.summaryText,
    "Ergebnisse\n\nMindestens 70 Bewerbungen sammeln: Gemessener Wert 75 bei Ziel 70. Dieses Ziel ist erreicht.",
  );
  assert.equal(record.insights.length, 1);
  assert.equal(record.insights[0]?.sourceType, "goal_alignment");
  assert.equal(
    record.insights[0]?.text,
    "Mindestens 70 Bewerbungen sammeln: Gemessener Wert 75 bei Ziel 70. Dieses Ziel ist erreicht.",
  );
  assert.deepEqual(record.insights[0]?.sourceUploadMetadataIds, ["upload-1"]);
});

test("previewActivityAnalysis strips placeholder tokens from rendered assessment text", async () => {
  const fixture = createServiceFixture({
    activityOutput: "Mindestens {{count}} Bewerbungen sammeln",
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "completed");
  assert.equal(record.validation.status, "passed");
  assert.equal(
    record.renderedSummary,
    "Ergebnisse\n\nMindestens Bewerbungen sammeln: Gemessener Wert 75 bei Ziel 70. Dieses Ziel ist erreicht.",
  );
});

test("previewActivityAnalysis persists requires_capability goals without executing fallback tools", async () => {
  const fixture = createServiceFixture({
    activityOutput: "Mindestens 70 Bewerbungen sammeln",
    plannerResponse: {
      goalPlans: [
        {
          goalId: "output_1",
          goalType: "output",
          goalText: "Mindestens 70 Bewerbungen sammeln",
          evaluationMode: "numeric_target",
          status: "requires_capability",
          rationale:
            "Für dieses Ziel wäre eine Häufigkeitsberechnung pro Zeitraum nötig.",
          plannedToolNames: [],
          missingCapabilities: [
            {
              kind: "deterministic_calculation",
              name: "event_frequency",
              reason:
                "Need events-per-period calculation by entity before target comparison.",
            },
          ],
        },
      ],
      toolRequests: [],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.status, "completed");
  assert.equal(record.validation.status, "passed");
  assert.equal(record.toolCallTrace.length, 0);
  assert.equal(record.calculations.length, 0);
  assert.equal(
    record.assessment?.goalAssessments[0]?.assessmentStatus,
    "requires_capability",
  );
  assert.deepEqual(record.assessment?.goalAssessments[0]?.missingCapabilities, [
    {
      kind: "deterministic_calculation",
      name: "event_frequency",
      reason:
        "Need events-per-period calculation by entity before target comparison.",
    },
  ]);
  assert.equal(record.diagnostics.executedToolCallCount, 0);
  assert.equal(record.diagnostics.goalStatusCounts.requiresCapability, 1);
  assert.equal(record.shadowComparison.status, "review_recommended");
  assert.equal(
    record.renderedSummary,
    "Ergebnisse\n\nMindestens 70 Bewerbungen sammeln: Dieses Ziel kann derzeit nicht belastbar bewertet werden. Es fehlt derzeit die deterministische Berechnungsfähigkeit: event_frequency (Need events-per-period calculation by entity before target comparison.). Für dieses Ziel wäre eine Häufigkeitsberechnung pro Zeitraum nötig.",
  );
});

test("previewActivityAnalysis rejects when any current upload is still missing privacy-safe evidence", async () => {
  const fixture = createServiceFixture({
    uploads: [
      {
        id: "upload-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        logicalEvidenceId: "evidence-1",
        versionNumber: 1,
        originalFileName: "mentors.csv",
        createdAt: NOW,
      },
      {
        id: "upload-2",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        logicalEvidenceId: "evidence-2",
        versionNumber: 1,
        originalFileName: "notes.csv",
        createdAt: NOW,
      },
    ],
    privacySafeRepresentations: [
      {
        id: "psr-1",
        uploadMetadataId: "upload-1",
        payload: {
          metadata: {
            evidenceModality: "structured_quantitative",
            interpretationDataType: "tabular_structured",
          },
        },
      },
    ],
  });

  await assert.rejects(
    fixture.service.previewActivityAnalysis("user-1", "activity-1"),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "activity_analysis_v2_not_ready",
      );
      return true;
    },
  );
  assert.equal(fixture.createdRuns.length, 0);
});

test("previewActivityAnalysis marks shadow comparison for review when V1 still renders an outcome section on an output-only activity", async () => {
  const fixture = createServiceFixture({
    activityAiKnowledgeSnapshot: {
      generatedAt: NOW,
      interpretedEvidenceCount: 1,
      totalEvidenceCount: 1,
      summaryText: "Ergebnisse\n\nV1 Output.\n\nWirkung\n\nV1 Outcome.",
      insights: [{ id: "insight-1" }],
    },
  });

  const record = await fixture.service.previewActivityAnalysis(
    "user-1",
    "activity-1",
  );

  assert.equal(record.shadowComparison.status, "review_recommended");
  assert.equal(
    record.shadowComparison.notes.some((note) =>
      note.includes("no outcome goals"),
    ),
    true,
  );
});
