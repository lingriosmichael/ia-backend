import { createHash } from "node:crypto";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { FastifyBaseLogger } from "fastify";
import type {
  ActivityAiKnowledgeRecord,
  ActivityAnalysisRunV2Record,
  ActivityAnalysisRunV2RunLimits,
  InterpretationQuestion,
} from "../../shared/contracts.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  PythonProcessingClient,
  type ActivityAnalysisV2EvidenceTableInput,
  type ActivityAnalysisV2ClarificationQuestionDraft,
  type ActivityAnalysisV2GoalInput,
  type ActivityAnalysisV2PlanResponse,
} from "../processing/pythonProcessingClient.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type {
  ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
  ActivityPersistenceRecord,
} from "../activity/activityPersistence.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "./activityAnalysisRunV2Persistence.js";
import { buildActivityAssessmentV2 } from "./activityAnalysisV2Assessment.js";
import { buildActivityAnalysisV2CutoverReadiness } from "./activityAnalysisV2Cutover.js";
import {
  buildActivityAnalysisV2Diagnostics,
  buildActivityAnalysisV2ShadowComparison,
} from "./activityAnalysisV2Shadow.js";
import { ActivityAnalysisV2ToolExecutor } from "./activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "./activityAnalysisV2ToolTypes.js";
import type {
  CurrentActivityEvidenceLoader,
  CurrentActivityEvidenceSnapshot,
} from "./currentActivityEvidenceLoader.js";
import {
  readRowRecords,
  readTableRecords,
} from "./deterministicAnalysisService.js";
import type { DatasetPreparationService } from "./datasetPreparationService.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";

// All four limits below are now actually enforced (see the evidence-item
// cap in previewActivityAnalysis and the tool-call-count/wall-clock checks
// in ActivityAnalysisV2ToolExecutor.execute). Raised from the original
// values now that enforcement exists, to give real multi-goal, multi-file
// activities headroom instead of tripping the cap on the happy path:
// - maxToolCalls 12 -> 24: a 3-4 goal activity with cross-file joins/cohorts
//   can reasonably need 6+ tool calls per goal.
// - maxLlmIterations 4 -> 5: total planner attempts (1 initial + up to 4
//   grounding-retry attempts) before falling back to a failed run.
// - timeoutMs 30_000 -> 150_000: sized for one Python planning call
//   (PYTHON_ANALYTICS_TIMEOUT_MS, 120_000 by default, see .env.example)
//   plus headroom for the backend's own deterministic tool execution; 30s
//   was already shorter than the Python planning call alone is allowed to
//   take. The auto-clarification replan loop below can issue one further
//   planning call, which is why MAX_BACKEND_AUTO_CLARIFICATION_REPLANS is
//   capped at 1 and the loop checks remaining budget before attempting it
//   — without both of those, a run could stack several full-length Python
//   calls and blow well past this budget before the check below ever runs.
// - maxEvidenceItems 25 -> 40: keeps a hard ceiling on worst-case cost
//   while covering larger real activities; excess evidence is dropped
//   oldest-first (see previewActivityAnalysis) rather than causing a
//   confusing partial failure.
const PHASE_1_RUN_LIMITS: ActivityAnalysisRunV2RunLimits = {
  maxToolCalls: 24,
  maxLlmIterations: 5,
  timeoutMs: 150_000,
  maxEvidenceItems: 40,
};

const PLANNER_CLARIFICATION_CONFIDENCE_THRESHOLD = 0.8;
// Each replan is a full additional Python planning call, bounded by
// PHASE_1_RUN_LIMITS.timeoutMs alongside the initial call (see the comment
// there). Keep this at 1 so the loop's worst case is two calls, not four.
const MAX_BACKEND_AUTO_CLARIFICATION_REPLANS = 1;

type PlannerClarificationAnswer = {
  questionId: string;
  goalId: string | null;
  prompt: string;
  answeredValue: string;
  questionCode:
    | "normalization_merge"
    | "row_grain"
    | "duplicate_identifier_resolution"
    | "primary_status_field"
    | "positive_status_values"
    | "primary_date_field"
    | null;
  targetTableName: string | null;
  targetColumnName: string | null;
};

type ClarificationAnswerDraftInput = {
  goalId: string | null;
  prompt: string;
  answeredValue: string;
  questionCode:
    | "normalization_merge"
    | "row_grain"
    | "duplicate_identifier_resolution"
    | "primary_status_field"
    | "positive_status_values"
    | "primary_date_field"
    | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
};

function buildPlannerClarificationAnswer(
  input: ClarificationAnswerDraftInput,
): PlannerClarificationAnswer {
  return {
    questionId: buildClarificationQuestionId({
      goalId: input.goalId,
      prompt: input.prompt,
      questionCode: input.questionCode,
      targetTableName: input.targetTableName ?? null,
      targetColumnName: input.targetColumnName ?? null,
    }),
    goalId: input.goalId,
    prompt: input.prompt,
    answeredValue: input.answeredValue,
    questionCode: input.questionCode,
    targetTableName: input.targetTableName ?? null,
    targetColumnName: input.targetColumnName ?? null,
  };
}

function mergePlannerClarificationAnswers(
  ...groups: PlannerClarificationAnswer[][]
): PlannerClarificationAnswer[] {
  const merged = new Map<string, PlannerClarificationAnswer>();
  for (const group of groups) {
    for (const answer of group) {
      merged.set(answer.questionId, answer);
    }
  }
  return [...merged.values()];
}

function extractPlannerErrorLogContext(error: unknown): Record<string, unknown> {
  if (!(error instanceof AppError)) {
    return {
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unknown planner failure before a plan was produced.",
    };
  }

  const details =
    error.details && typeof error.details === "object"
      ? (error.details as Record<string, unknown>)
      : null;

  return {
    errorCode: error.code,
    errorStatusCode: error.statusCode,
    errorMessage: error.message,
    upstreamStatus:
      typeof details?.upstreamStatus === "number"
        ? details.upstreamStatus
        : undefined,
    upstreamStatusText:
      typeof details?.upstreamStatusText === "string"
        ? details.upstreamStatusText
        : undefined,
    upstreamBodyPreview:
      typeof details?.upstreamBody === "string"
        ? details.upstreamBody
        : undefined,
    requestUrl:
      typeof details?.url === "string" ? details.url : undefined,
    requestPath:
      typeof details?.path === "string" ? details.path : undefined,
    requestMethod:
      typeof details?.method === "string" ? details.method : undefined,
    requestTimeoutMs:
      typeof details?.timeoutMs === "number" ? details.timeoutMs : undefined,
  };
}

function extractGoalTargetNumberForActivityAnalysisV2(
  goalText: string,
): number | null {
  const match = goalText.match(
    /(\d+(?:[.,]\d+)?)(\s*%|\s*(?:prozent|percent))?/i,
  );
  if (!match) {
    return null;
  }

  const parsed = Number((match[1] ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const percentSuffix = match[2];
  if (percentSuffix) {
    return parsed / 100;
  }

  return parsed;
}

function isActionableLimitation(limitation: string): boolean {
  const normalized = limitation.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (
    normalized.startsWith("planner model version:") ||
    normalized.startsWith("planning retries used:")
  ) {
    return false;
  }
  return true;
}

function buildRecommendationPolicy(
  assessment: NonNullable<ActivityAnalysisRunV2PersistenceRecord["assessment"]>,
): {
  recommendationPolicy: "required" | "optional";
  actionableLimitations: string[];
} {
  const actionableLimitations = assessment.limitations.filter(
    isActionableLimitation,
  );
  const hasNonAchievedOrUnresolvedGoal = assessment.goalAssessments.some(
    (goalAssessment) => goalAssessment.assessmentStatus !== "achieved",
  );

  return {
    recommendationPolicy:
      hasNonAchievedOrUnresolvedGoal || actionableLimitations.length > 0
        ? "required"
        : "optional",
    actionableLimitations,
  };
}


function mapActivityAnalysisRunV2Record(
  run: ActivityAnalysisRunV2PersistenceRecord,
): ActivityAnalysisRunV2Record {
  const cutoverReadiness = buildActivityAnalysisV2CutoverReadiness({
    diagnostics: run.diagnostics,
    shadowComparison: run.shadowComparison,
    validation: run.validation,
  });
  return {
    analysisRunId: run.id,
    activityId: run.activityId,
    projectId: run.projectId,
    activityName: run.activityName,
    phase: run.phase,
    status: run.status,
    goalsSnapshot: {
      activityType: run.goalsSnapshot.activityType,
      objectives: run.goalsSnapshot.objectives,
      output: run.goalsSnapshot.output,
      outcome: run.goalsSnapshot.outcome,
    },
    evidence: run.evidence.map((item) => ({
      uploadMetadataId: item.uploadMetadataId,
      privacySafeRepresentationId: item.privacySafeRepresentationId,
      logicalEvidenceId: item.logicalEvidenceId,
      versionNumber: item.versionNumber,
      originalFileName: item.originalFileName,
      evidenceModality: item.evidenceModality,
      uploadedAt: item.uploadedAt.toISOString(),
    })),
    runLimits: {
      maxToolCalls: run.runLimits.maxToolCalls,
      maxLlmIterations: run.runLimits.maxLlmIterations,
      timeoutMs: run.runLimits.timeoutMs,
      maxEvidenceItems: run.runLimits.maxEvidenceItems,
    },
    clarificationQuestions: run.clarificationQuestions.map((question) => ({
      ...question,
      goalId: question.goalId ?? null,
    })),
    toolCallTrace: run.toolCallTrace.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      calculationIds: [...toolCall.calculationIds],
      status: toolCall.status,
      errorMessage: toolCall.errorMessage,
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      durationMs: toolCall.durationMs,
    })),
    calculations: run.calculations.map((calculation) => ({
      calculationId: calculation.calculationId,
      toolName: calculation.toolName,
      label: calculation.label,
      description: calculation.description,
      formula: calculation.formula,
      value: calculation.value,
      unit: calculation.unit,
      sourceUploadMetadataIds: [...calculation.sourceUploadMetadataIds],
      sourceTableNames: [...calculation.sourceTableNames],
      sourceColumns: [...calculation.sourceColumns],
      grain: calculation.grain,
      numerator: calculation.numerator ?? null,
      denominator: calculation.denominator ?? null,
      denominatorType: calculation.denominatorType,
      identifierColumn: calculation.identifierColumn ?? null,
      result: calculation.result,
    })),
    assessment: run.assessment,
    diagnostics: run.diagnostics,
    shadowComparison: run.shadowComparison,
    cutoverReadiness,
    validation: {
      status: run.validation.status,
      issues: [...run.validation.issues],
    },
    renderedSummary: run.renderedSummary,
    recommendationText: run.recommendationText,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function splitGoalText(goalText: string | null): string[] {
  if (!goalText) {
    return [];
  }

  return goalText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^(?:[-*•]+|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function buildClarificationQuestionId(input: {
  goalId: string | null;
  prompt: string;
  questionCode: string | null;
  targetTableName: string | null;
  targetColumnName: string | null;
}): string {
  return `aaq_${createHash("sha1")
    .update(
      [
        input.goalId ?? "",
        input.questionCode ?? "",
        input.targetTableName ?? "",
        input.targetColumnName ?? "",
        input.prompt.trim(),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16)}`;
}

function mapLegacyActivityAiKnowledgeRecord(
  run: ActivityAnalysisRunV2Record,
): ActivityAiKnowledgeRecord {
  const calculationsById = new Map(
    run.calculations.map((calculation) => [
      calculation.calculationId,
      calculation.sourceUploadMetadataIds,
    ]),
  );
  const insights =
    run.assessment?.goalAssessments.map((goalAssessment) => ({
      id: `v2_goal_${goalAssessment.goalId}`,
      sourceType: "goal_alignment" as const,
      text: goalAssessment.findingText,
      isGoalRelevant: true,
      sourceUploadMetadataIds: Array.from(
        new Set(
          goalAssessment.supportingCalculationIds.flatMap(
            (calculationId) => calculationsById.get(calculationId) ?? [],
          ),
        ),
      ),
    })) ?? [];

  return {
    activityId: run.activityId,
    projectId: run.projectId,
    activityName: run.activityName,
    interpretedEvidenceCount: run.evidence.length,
    totalEvidenceCount: run.evidence.length,
    generatedAt: run.createdAt,
    summaryText: run.renderedSummary ?? "",
    insights,
  };
}

export class ActivityAnalysisV2Service {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
    private readonly activityAnalysisRunV2Repository: ActivityAnalysisRunV2Repository,
    private readonly activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationService: DatasetPreparationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private buildEvidenceSnapshotRecords(
    evidenceSnapshot: Awaited<
      ReturnType<CurrentActivityEvidenceLoader["load"]>
    >,
  ): ActivityAnalysisRunV2PersistenceRecord["evidence"] {
    return evidenceSnapshot.evidence.map((item) => ({
      uploadMetadataId: item.uploadMetadataId,
      privacySafeRepresentationId: item.privacySafeRepresentationId,
      logicalEvidenceId: item.logicalEvidenceId,
      versionNumber: item.versionNumber,
      originalFileName: item.originalFileName,
      evidenceModality: item.evidenceModality,
      uploadedAt: item.uploadedAt,
    }));
  }

  // A question is only ever omitted here if it's in resolvedQuestionIds —
  // i.e. the backend actually merged an answer for it into a replan this
  // run (see autoResolvedQuestionIds in previewActivityAnalysis). A high
  // recommendedConfidence is not by itself proof that happened: the replan
  // loop is bounded by both an attempt cap and a wall-clock budget, so a
  // high-confidence question can still be sitting unresolved in the
  // planner's final response if the loop gave up before reaching it.
  // Filtering on confidence alone previously hid exactly those cases from
  // the user instead of surfacing them.
  private buildClarificationQuestions(
    drafts: ActivityAnalysisV2ClarificationQuestionDraft[],
    existingAnswers: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[],
    resolvedQuestionIds: ReadonlySet<string>,
  ): InterpretationQuestion[] {
    const answerByQuestionId = new Map(
      existingAnswers.map((answer) => [answer.questionId, answer]),
    );

    return (drafts ?? []).flatMap((draft) => {
      const questionId = buildClarificationQuestionId({
        goalId: draft.goalId ?? null,
        prompt: draft.prompt,
        questionCode: draft.questionCode ?? null,
        targetTableName: draft.targetTableName ?? null,
        targetColumnName: draft.targetColumnName ?? null,
      });

      if (resolvedQuestionIds.has(questionId)) {
        return [];
      }

      const answered = answerByQuestionId.get(questionId) ?? null;
      return [
        {
          id: questionId,
          goalId: draft.goalId ?? null,
          prompt: draft.prompt,
          kind: draft.kind,
          questionDomain: draft.questionDomain,
          options: draft.options ?? null,
          recommendedOption: draft.recommendedOption ?? null,
          recommendedConfidence: draft.recommendedConfidence ?? null,
          isBlocking: draft.isBlocking,
          questionCode: draft.questionCode ?? null,
          targetTableName: draft.targetTableName ?? null,
          targetColumnName: draft.targetColumnName ?? null,
          status: answered ? ("answered" as const) : ("pending" as const),
          answeredValue: answered?.answeredValue ?? null,
          answeredById: answered?.answeredById ?? null,
          answeredAt: answered?.answeredAt.toISOString() ?? null,
        },
      ];
    });
  }

  private buildAutoResolvedPlannerClarificationAnswers(
    drafts: ActivityAnalysisV2ClarificationQuestionDraft[],
  ): PlannerClarificationAnswer[] {
    return (drafts ?? []).flatMap((draft) => {
      const recommendedOption = draft.recommendedOption?.trim();
      if (
        !recommendedOption ||
        typeof draft.recommendedConfidence !== "number" ||
        draft.recommendedConfidence <
          PLANNER_CLARIFICATION_CONFIDENCE_THRESHOLD
      ) {
        return [];
      }

      return [
        buildPlannerClarificationAnswer({
          goalId: draft.goalId ?? null,
          prompt: draft.prompt,
          answeredValue: recommendedOption,
          questionCode: draft.questionCode ?? null,
          targetTableName: draft.targetTableName ?? null,
          targetColumnName: draft.targetColumnName ?? null,
        }),
      ];
    });
  }

  private buildPlannerClarificationAnswers(
    activity: ActivityPersistenceRecord,
  ): PlannerClarificationAnswer[] {
    return (activity.activityAnalysisV2ClarificationAnswers ?? []).map(
      (answer) => ({
        questionId: answer.questionId,
        goalId: answer.goalId ?? null,
        prompt: answer.prompt,
        answeredValue: answer.answeredValue,
        questionCode: answer.questionCode ?? null,
        targetTableName: answer.targetTableName ?? null,
        targetColumnName: answer.targetColumnName ?? null,
      }),
    );
  }

  private async generateNarrativeTexts(input: {
    activityId: string;
    activityName: string;
    language: "de" | "en";
    assessment: NonNullable<ActivityAnalysisRunV2PersistenceRecord["assessment"]>;
    calculations: ActivityAnalysisRunV2PersistenceRecord["calculations"];
  }): Promise<{
    renderedSummary: string;
    recommendationText: string | null;
  }> {
    try {
      const { recommendationPolicy, actionableLimitations } =
        buildRecommendationPolicy(
        input.assessment,
      );
      const response =
        await this.pythonProcessingClient.generateActivityAnalysisV2Recommendation(
          {
            activityId: input.activityId,
            activityName: input.activityName,
            language: input.language,
            recommendationPolicy,
            goalAssessments: input.assessment.goalAssessments.map(
              (goalAssessment) => ({
                goalId: goalAssessment.goalId,
                goalType: goalAssessment.goalType,
                goalText: goalAssessment.goalText,
                assessmentStatus: goalAssessment.assessmentStatus,
                findingText: goalAssessment.findingText,
                measuredValue: goalAssessment.measuredValue,
                targetValue: goalAssessment.targetValue,
                comparison: goalAssessment.comparison,
                achieved: goalAssessment.achieved,
              }),
            ),
            limitations: actionableLimitations,
            calculations: input.calculations.map((calculation) => ({
              calculationId: calculation.calculationId,
              toolName: calculation.toolName,
              label: calculation.label,
              description: calculation.description,
              value: calculation.value,
              unit: calculation.unit,
              sourceTableNames: calculation.sourceTableNames,
              sourceColumns: calculation.sourceColumns,
              grain: calculation.grain,
              numerator: calculation.numerator ?? null,
              denominator: calculation.denominator ?? null,
              denominatorType: calculation.denominatorType,
              identifierColumn: calculation.identifierColumn ?? null,
              result: calculation.result,
            })),
          },
        );
      const renderedSummary = response.summaryText.trim();
      const recommendationText = response.recommendationText.trim();
      if (renderedSummary.length === 0) {
        throw new AppError(
          "The Python processing service returned an empty ActivityAnalystV2 summary.",
          502,
          "python_processing_activity_analysis_v2_summary_empty",
        );
      }
      if (
        recommendationPolicy === "required" &&
        recommendationText.length === 0
      ) {
        throw new AppError(
          "The Python processing service returned an empty ActivityAnalystV2 recommendation.",
          502,
          "python_processing_activity_analysis_v2_recommendation_empty",
        );
      }
      return {
        renderedSummary,
        recommendationText: recommendationText.length > 0 ? recommendationText : null,
      };
    } catch (error) {
      this.logger.warn(
        {
          activityId: input.activityId,
          ...extractPlannerErrorLogContext(error),
        },
        "ActivityAnalystV2 narrative generation failed",
      );
      throw error;
    }
  }

  /**
   * Enforces `maxEvidenceItems` by dropping the oldest current uploads
   * first, keeping the most recently uploaded evidence for analysis. Without
   * this, an activity with more uploads than the configured cap would be
   * sent to the planner/tool executor in full, silently ignoring the limit.
   */
  private applyEvidenceItemCap(
    activityId: string,
    evidenceSnapshot: CurrentActivityEvidenceSnapshot,
  ): void {
    const limit = PHASE_1_RUN_LIMITS.maxEvidenceItems;
    if (evidenceSnapshot.evidence.length <= limit) {
      return;
    }

    const droppedCount = evidenceSnapshot.evidence.length - limit;
    evidenceSnapshot.evidence = [...evidenceSnapshot.evidence]
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .slice(0, limit);

    this.logger.warn(
      { activityId, limit, droppedCount },
      "ActivityAnalystV2 evidence exceeded maxEvidenceItems; dropped the oldest uploads",
    );
  }

  private buildGoals(activity: {
    output: string | null;
    outcome: string | null;
  }): ActivityAnalysisV2GoalInput[] {
    const outputs = splitGoalText(activity.output).map((goalText, index) => ({
      goalId: `output_${index + 1}`,
      goalType: "output" as const,
      goalText,
      targetNumber: extractGoalTargetNumberForActivityAnalysisV2(goalText),
    }));
    const outcomes = splitGoalText(activity.outcome).map((goalText, index) => ({
      goalId: `outcome_${index + 1}`,
      goalType: "outcome" as const,
      goalText,
      targetNumber: extractGoalTargetNumberForActivityAnalysisV2(goalText),
    }));
    return [...outputs, ...outcomes];
  }

  private async buildEvidenceTables(input: {
    activityId: string;
    evidenceSnapshot: Awaited<
      ReturnType<CurrentActivityEvidenceLoader["load"]>
    >;
  }): Promise<
    Array<{
      uploadMetadataId: string;
      originalFileName: string;
      evidenceModality: string | null;
      tableName: string;
      rowCount: number;
      identifierColumn: string | null;
      identifierHandling:
        | "assume_unique"
        | "allow_duplicate_rows_as_events"
        | "deduplicate_by_identifier"
        | "manual_review_required"
        | null;
      primaryStatusColumn: string | null;
      primaryDateColumn: string | null;
      columns: Array<{
        name: string;
        role:
          | "identifier"
          | "primary_status"
          | "primary_date"
          | "measure"
          | "subgroup"
          | "free_text"
          | "other"
          | null;
        inferredType:
          | "identifier"
          | "numeric"
          | "date"
          | "categorical"
          | "free_text"
          | "boolean"
          | "unknown"
          | null;
      }>;
    }>
  > {
    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        input.evidenceSnapshot.evidence.map((item) => item.uploadMetadataId),
        databaseSession,
      );
    const preparations =
      await this.datasetPreparationService.findByInterpretationResultIds(
        results.map((result) => result.id),
      );
    const preparationByInterpretationResultId = new Map(
      preparations.map((preparation) => [
        preparation.interpretationResultId,
        preparation,
      ]),
    );
    const resultByUploadId = new Map(
      results.map((result) => [result.uploadMetadataId, result]),
    );

    return input.evidenceSnapshot.evidence.flatMap((evidence) => {
      const result = resultByUploadId.get(evidence.uploadMetadataId) ?? null;
      const preparation = result
        ? (preparationByInterpretationResultId.get(result.id) ?? null)
        : null;
      const preparedTablesByName = new Map(
        (preparation?.preparedDataset?.tables ?? []).map((table) => [
          table.name,
          table,
        ]),
      );

      return readTableRecords(evidence.payload).map((table) => {
        const tableName = typeof table.name === "string" ? table.name : "table";
        const preparedTable = preparedTablesByName.get(tableName) ?? null;
        const rows = readRowRecords(table.rows);
        return {
          uploadMetadataId: evidence.uploadMetadataId,
          originalFileName: evidence.originalFileName,
          evidenceModality: evidence.evidenceModality,
          tableName,
          rowCount: rows.length,
          identifierColumn: preparedTable?.identifierColumn ?? null,
          identifierHandling: preparedTable?.identifierHandling ?? null,
          primaryStatusColumn: preparedTable?.primaryStatusColumn ?? null,
          primaryDateColumn: preparedTable?.primaryDateColumn ?? null,
          columns:
            preparedTable?.columns.map((column) => ({
              name: column.name,
              role: column.role,
              inferredType: column.inferredType,
            })) ??
            Object.keys(rows[0] ?? {}).map((columnName) => ({
              name: columnName,
              role: null,
              inferredType: null,
            })),
        };
      });
    });
  }

  async previewActivityAnalysis(
    userId: string,
    activityId: string,
    language: "de" | "en" = "de",
  ): Promise<ActivityAnalysisRunV2Record> {
    const runStartedAt = Date.now();
    const { activity, project } =
      await this.authorizationService.canEditActivity(userId, activityId);
    const evidenceSnapshot =
      await this.currentActivityEvidenceLoader.load(activityId);
    this.applyEvidenceItemCap(activityId, evidenceSnapshot);

    if (evidenceSnapshot.evidence.length === 0) {
      throw new AppError(
        "This activity has no current privacy-safe evidence yet.",
        409,
        "activity_analysis_v2_not_ready",
      );
    }

    if (evidenceSnapshot.missingPrivacySafeUploads.length > 0) {
      throw new AppError(
        "Every current evidence file must complete privacy-safe processing before ActivityAnalystV2 preview is available.",
        409,
        "activity_analysis_v2_not_ready",
        {
          missingPrivacySafeUploads: evidenceSnapshot.missingPrivacySafeUploads,
        },
      );
    }

    const goals = this.buildGoals(activity);
    this.logger.info(
      {
        activityId: activity.id,
        projectId: project.id,
        evidenceCount: evidenceSnapshot.evidence.length,
        goalCount: goals.length,
        language,
      },
      "starting ActivityAnalystV2 shadow preview",
    );
    const evidenceTables = await this.buildEvidenceTables({
      activityId,
      evidenceSnapshot,
    });
    const persistedClarificationAnswers =
      activity.activityAnalysisV2ClarificationAnswers ?? [];
    let plannerClarificationAnswers = this.buildPlannerClarificationAnswers(
      activity,
    );

    const planWithClarificationAnswers = async () =>
      this.pythonProcessingClient.planActivityAnalysisV2({
          activityId: activity.id,
          activityName: activity.name,
          language,
          goals,
          evidenceTables,
          clarificationAnswers: plannerClarificationAnswers,
          runLimits: PHASE_1_RUN_LIMITS,
        });

    let plannerResponse: Awaited<
      ReturnType<typeof this.pythonProcessingClient.planActivityAnalysisV2>
    >;
    // Tracks only the questions the backend actually merged into a replan
    // this run, as opposed to every high-confidence question the planner
    // ever surfaced. buildClarificationQuestions uses this — not
    // recommendedConfidence — to decide what to hide from a human, so a
    // question the loop gave up on (replan cap or time budget) still
    // reaches the user instead of silently vanishing. See the comment on
    // buildClarificationQuestions for why confidence alone isn't a safe
    // signal that a question was actually resolved.
    const autoResolvedQuestionIds = new Set<string>();
    try {
      plannerResponse = await planWithClarificationAnswers();
      for (
        let autoResolvedPass = 0;
        autoResolvedPass < MAX_BACKEND_AUTO_CLARIFICATION_REPLANS;
        autoResolvedPass += 1
      ) {
        const autoResolvedAnswers =
          this.buildAutoResolvedPlannerClarificationAnswers(
            plannerResponse.clarificationQuestions ?? [],
          ).filter(
            (answer) =>
              !plannerClarificationAnswers.some(
                (existing) => existing.questionId === answer.questionId,
              ),
          );

        if (autoResolvedAnswers.length === 0) {
          break;
        }

        // A replan call can itself take up to the Python service's full
        // analytics timeout. Only attempt one if the run still has that
        // much budget left — otherwise this would blow past
        // PHASE_1_RUN_LIMITS.timeoutMs anyway, just later, after wasting
        // another full call's worth of wall-clock time first. Falling
        // through here leaves plannerResponse (and its unresolved
        // clarification questions) as-is; the timeout check right after
        // this loop still catches a genuine first-call overrun.
        const remainingBudgetMs =
          PHASE_1_RUN_LIMITS.timeoutMs - (Date.now() - runStartedAt);
        if (
          remainingBudgetMs <= this.pythonProcessingClient.analyticsTimeoutMs
        ) {
          break;
        }

        for (const answer of autoResolvedAnswers) {
          autoResolvedQuestionIds.add(answer.questionId);
        }
        plannerClarificationAnswers = mergePlannerClarificationAnswers(
          plannerClarificationAnswers,
          autoResolvedAnswers,
        );
        plannerResponse = await planWithClarificationAnswers();
      }
    } catch (error) {
      const failedValidation = {
        status: "failed" as const,
        issues: [
          error instanceof Error
            ? error.message
            : "ActivityAnalystV2 planner call failed.",
        ],
      };
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: 0,
        executedToolCallCount: 0,
        calculationCount: 0,
        validation: failedValidation,
        renderedSummary: null,
        assessment: null,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: failedValidation,
        renderedSummary: null,
        assessment: null,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      const failedRun = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_3_goal_planner",
          status: "failed",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: this.buildEvidenceSnapshotRecords(evidenceSnapshot),
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions: [],
          toolCallTrace: [],
          calculations: [],
          assessment: null,
          diagnostics,
          shadowComparison,
          renderedSummary: null,
          recommendationText: null,
          validation: failedValidation,
          errorMessage:
            error instanceof Error
              ? error.message
              : "ActivityAnalystV2 planner call failed.",
        },
        databaseSession,
      );
      this.logger.error(
        { activityId: activity.id, ...extractPlannerErrorLogContext(error) },
        "ActivityAnalystV2 planner call failed before a plan was produced",
      );
      return mapActivityAnalysisRunV2Record(failedRun);
    }

    const clarificationQuestions = this.buildClarificationQuestions(
      plannerResponse.clarificationQuestions ?? [],
      persistedClarificationAnswers,
      autoResolvedQuestionIds,
    );
    const evidenceRecords = this.buildEvidenceSnapshotRecords(evidenceSnapshot);

    if (Date.now() - runStartedAt > PHASE_1_RUN_LIMITS.timeoutMs) {
      const timeoutMessage = `ActivityAnalystV2 run exceeded its configured time budget of ${PHASE_1_RUN_LIMITS.timeoutMs}ms before deterministic execution could start.`;
      const timeoutValidation = {
        status: "failed" as const,
        issues: [timeoutMessage],
      };
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: plannerResponse.toolRequests.length,
        executedToolCallCount: 0,
        calculationCount: 0,
        validation: timeoutValidation,
        renderedSummary: null,
        assessment: null,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: timeoutValidation,
        renderedSummary: null,
        assessment: null,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      const timedOutRun = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_3_goal_planner",
          status: "failed",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: evidenceRecords,
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions,
          toolCallTrace: [],
          calculations: [],
          assessment: null,
          diagnostics,
          shadowComparison,
          renderedSummary: null,
          recommendationText: null,
          validation: timeoutValidation,
          errorMessage: timeoutMessage,
        },
        databaseSession,
      );
      this.logger.error(
        { activityId: activity.id, elapsedMs: Date.now() - runStartedAt },
        "ActivityAnalystV2 run exceeded its time budget before deterministic execution",
      );
      return mapActivityAnalysisRunV2Record(timedOutRun);
    }

    let run: ActivityAnalysisRunV2PersistenceRecord;
    if (plannerResponse.validation.status === "failed") {
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: plannerResponse.toolRequests.length,
        executedToolCallCount: 0,
        calculationCount: 0,
        validation: plannerResponse.validation,
        renderedSummary: null,
        assessment: null,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: plannerResponse.validation,
        renderedSummary: null,
        assessment: null,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      run = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_3_goal_planner",
          status: "failed",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: evidenceRecords,
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions,
          toolCallTrace: [],
          calculations: [],
          assessment: null,
          diagnostics,
          shadowComparison,
          renderedSummary: null,
          recommendationText: null,
          validation: plannerResponse.validation,
          errorMessage: "ActivityAnalystV2 planner returned an invalid plan.",
        },
        databaseSession,
      );
      this.logger.warn(
        {
          activityId: activity.id,
          validationIssues: plannerResponse.validation.issues,
          shadowComparisonStatus: shadowComparison.status,
        },
        "ActivityAnalystV2 planner returned an invalid shadow plan",
      );
      return mapActivityAnalysisRunV2Record(run);
    }

    if (
      clarificationQuestions.some((question) => question.status === "pending")
    ) {
      const pausedValidation = {
        status: "passed" as const,
        issues: [],
      };
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: 0,
        executedToolCallCount: 0,
        calculationCount: 0,
        validation: pausedValidation,
        renderedSummary: null,
        assessment: null,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: pausedValidation,
        renderedSummary: null,
        assessment: null,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      run = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_3_goal_planner",
          status: "needs_clarification",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: evidenceRecords,
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions,
          toolCallTrace: [],
          calculations: [],
          assessment: null,
          diagnostics,
          shadowComparison,
          renderedSummary: null,
          recommendationText: null,
          validation: pausedValidation,
          errorMessage: null,
        },
        databaseSession,
      );
      return mapActivityAnalysisRunV2Record(run);
    }

    const plannedToolRequests: ActivityAnalysisV2ToolRequest[] =
      plannerResponse.toolRequests.map(
        (toolRequest) =>
          ({
            alias: toolRequest.alias ?? undefined,
            toolName: toolRequest.toolName,
            arguments: toolRequest.arguments,
          }) as ActivityAnalysisV2ToolRequest,
      );

    try {
      const execution =
        plannedToolRequests.length > 0
          ? await this.activityAnalysisV2ToolExecutor.execute(
              plannedToolRequests,
              evidenceSnapshot,
              PHASE_1_RUN_LIMITS,
              runStartedAt,
            )
          : {
              toolCallTrace: [],
              calculations: [],
            };
      const assessmentResult = buildActivityAssessmentV2({
        language,
        goals: plannerResponse.goalPlans,
        plannedToolRequests: plannerResponse.toolRequests,
        toolCallTrace: execution.toolCallTrace,
        calculations: execution.calculations,
        limitations: plannerResponse.limitations,
      });
      const narrative = await this.generateNarrativeTexts({
        activityId: activity.id,
        activityName: activity.name,
        language,
        assessment: assessmentResult.assessment,
        calculations: execution.calculations,
      });
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: plannerResponse.toolRequests.length,
        executedToolCallCount: execution.toolCallTrace.length,
        calculationCount: execution.calculations.length,
        validation: assessmentResult.validation,
        renderedSummary: narrative.renderedSummary,
        assessment: assessmentResult.assessment,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: assessmentResult.validation,
        renderedSummary: narrative.renderedSummary,
        assessment: assessmentResult.assessment,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      run = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_4_rendering",
          status: "completed",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: evidenceRecords,
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions: [],
          toolCallTrace: execution.toolCallTrace,
          calculations: execution.calculations,
          assessment: assessmentResult.assessment,
          diagnostics,
          shadowComparison,
          renderedSummary: narrative.renderedSummary,
          recommendationText: narrative.recommendationText,
          validation: assessmentResult.validation,
          errorMessage: null,
        },
        databaseSession,
      );
      this.logger.info(
        {
          activityId: activity.id,
          analysisRunId: run.id,
          diagnostics,
          shadowComparisonStatus: shadowComparison.status,
        },
        "ActivityAnalystV2 shadow preview completed",
      );
    } catch (error) {
      const toolCallTrace =
        error &&
        typeof error === "object" &&
        "toolCallTrace" in error &&
        Array.isArray(error.toolCallTrace)
          ? (error.toolCallTrace as ActivityAnalysisRunV2PersistenceRecord["toolCallTrace"])
          : [];
      const calculations =
        error &&
        typeof error === "object" &&
        "calculations" in error &&
        Array.isArray(error.calculations)
          ? (error.calculations as ActivityAnalysisRunV2PersistenceRecord["calculations"])
          : [];
      const failedValidation = {
        status: "failed" as const,
        issues: [
          error instanceof Error
            ? error.message
            : "Phase 3 planned deterministic execution failed.",
        ],
      };
      const diagnostics = buildActivityAnalysisV2Diagnostics({
        goals,
        evidenceCount: evidenceSnapshot.evidence.length,
        plannedToolRequestCount: plannerResponse.toolRequests.length,
        executedToolCallCount: toolCallTrace.length,
        calculationCount: calculations.length,
        validation: failedValidation,
        renderedSummary: null,
        assessment: null,
      });
      const shadowComparison = buildActivityAnalysisV2ShadowComparison({
        hasOutcomeGoals: goals.some((goal) => goal.goalType === "outcome"),
        currentEvidenceCount: evidenceSnapshot.evidence.length,
        validation: failedValidation,
        renderedSummary: null,
        assessment: null,
        v1Snapshot: activity.aiKnowledgeSnapshot ?? null,
      });
      run = await this.activityAnalysisRunV2Repository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          activityId: activity.id,
          activityName: activity.name,
          phase: "phase_3_goal_planner",
          status: "failed",
          goalsSnapshot: {
            activityType: activity.activityType,
            objectives: activity.objectives,
            output: activity.output,
            outcome: activity.outcome,
          },
          evidence: evidenceRecords,
          runLimits: PHASE_1_RUN_LIMITS,
          clarificationQuestions: [],
          toolCallTrace,
          calculations,
          assessment: null,
          diagnostics,
          shadowComparison,
          renderedSummary: null,
          recommendationText: null,
          validation: failedValidation,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Phase 3 planned deterministic execution failed.",
        },
        databaseSession,
      );
      this.logger.error(
        {
          activityId: activity.id,
          error,
          shadowComparisonStatus: shadowComparison.status,
        },
        "ActivityAnalystV2 shadow preview failed",
      );
    }

    return mapActivityAnalysisRunV2Record(run);
  }

  async answerClarificationQuestion(
    userId: string,
    activityId: string,
    questionId: string,
    answeredValue: string,
    language: "de" | "en" = "de",
  ): Promise<ActivityAnalysisRunV2Record> {
    await this.authorizationService.canEditActivity(userId, activityId);
    const latestRun =
      await this.activityAnalysisRunV2Repository.findLatestByActivityId(
        activityId,
        databaseSession,
      );

    if (!latestRun) {
      throw new AppError(
        "No ActivityAnalystV2 run exists for this activity yet.",
        404,
        "activity_analysis_v2_not_found",
      );
    }

    const question = latestRun.clarificationQuestions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) {
      throw new AppError(
        "This ActivityAnalystV2 clarification question was not found.",
        404,
        "activity_analysis_v2_question_not_found",
      );
    }

    // The HTTP schema only checks that answeredValue is a non-empty string
    // — it can't know this question's specific kind/options, since those
    // only exist once the question is loaded here. Whenever the question
    // offers a fixed set of options (single_choice, merge_confirmation),
    // that's the only UI the frontend ever renders for it, so the backend
    // must reject anything else instead of forwarding an arbitrary string
    // to the planner as if it were one of the offered choices.
    if (question.options && question.options.length > 0) {
      if (!question.options.includes(answeredValue)) {
        throw new AppError(
          "This answer is not one of the options offered for this clarification question.",
          422,
          "activity_analysis_v2_question_invalid_answer",
          { allowedOptions: question.options },
        );
      }
    }

    await this.activityRepository.upsertClarificationAnswer(
      activityId,
      {
        questionId,
        goalId: question.goalId ?? null,
        prompt: question.prompt,
        kind: question.kind,
        questionDomain: question.questionDomain,
        options: question.options ?? null,
        recommendedOption: question.recommendedOption ?? null,
        recommendedConfidence: question.recommendedConfidence ?? null,
        isBlocking: question.isBlocking,
        questionCode: question.questionCode ?? null,
        targetTableName: question.targetTableName ?? null,
        targetColumnName: question.targetColumnName ?? null,
        answeredValue,
        answeredById: userId,
        answeredAt: new Date(),
      },
      databaseSession,
    );

    return this.previewActivityAnalysis(userId, activityId, language);
  }

  async getLatestActivityAnalysis(
    userId: string,
    activityId: string,
  ): Promise<ActivityAnalysisRunV2Record> {
    await this.authorizationService.canViewActivity(userId, activityId);
    const run =
      await this.activityAnalysisRunV2Repository.findLatestByActivityId(
        activityId,
        databaseSession,
      );

    if (!run) {
      throw new AppError(
        "No ActivityAnalystV2 shadow run exists for this activity yet.",
        404,
        "activity_analysis_v2_not_found",
      );
    }

    return mapActivityAnalysisRunV2Record(run);
  }

  /**
   * Deprecated compatibility shape for older `/ai-knowledge` readers.
   * The source of truth is now the latest ActivityAnalystV2 run, not
   * `activity.aiKnowledgeSnapshot`.
   */
  async getLegacyActivityAiKnowledge(
    userId: string,
    activityId: string,
  ): Promise<ActivityAiKnowledgeRecord> {
    try {
      const run = await this.getLatestActivityAnalysis(userId, activityId);
      return mapLegacyActivityAiKnowledgeRecord(run);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "activity_analysis_v2_not_found"
      ) {
        throw new AppError(
          "This activity has no generated activity analysis yet.",
          404,
          "activity_ai_knowledge_not_found",
        );
      }
      throw error;
    }
  }

  /**
   * Deprecated compatibility wrapper for older `/ai-knowledge` writers.
   * It now runs ActivityAnalystV2 and maps the result into the legacy
   * response shape instead of generating a separate AI-knowledge snapshot.
   */
  async previewLegacyActivityAiKnowledge(
    userId: string,
    activityId: string,
    language: "de" | "en" = "de",
  ): Promise<ActivityAiKnowledgeRecord> {
    const run = await this.previewActivityAnalysis(
      userId,
      activityId,
      language,
    );
    return mapLegacyActivityAiKnowledgeRecord(run);
  }

  async listActivityAnalyses(
    userId: string,
    activityId: string,
    limit = 10,
  ): Promise<ActivityAnalysisRunV2Record[]> {
    await this.authorizationService.canViewActivity(userId, activityId);
    const runs = await this.activityAnalysisRunV2Repository.listByActivityId(
      activityId,
      limit,
      databaseSession,
    );
    return runs.map(mapActivityAnalysisRunV2Record);
  }

  async listProjectAnalyses(
    userId: string,
    projectId: string,
    limit = 20,
  ): Promise<ActivityAnalysisRunV2Record[]> {
    await this.authorizationService.canViewProject(userId, projectId);
    const runs = await this.activityAnalysisRunV2Repository.listByProjectId(
      projectId,
      limit,
      databaseSession,
    );
    return runs.map(mapActivityAnalysisRunV2Record);
  }
}
