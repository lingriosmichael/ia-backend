import { createHash } from "node:crypto";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { FastifyBaseLogger } from "fastify";
import type {
  ActivityAnalysisRunV2Record,
  ActivityAnalysisRunV2RunLimits,
  InterpretationQuestion,
  InterpretationQuestionCode,
  LlmUsageSummary,
} from "../../shared/contracts.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  extractSyntheticQualitativeCodeColumnMetadata,
  preparedDatasetTableWithSyntheticColumns,
  qualitativeCodingReviewRequirementStatus,
} from "../processing/qualitativeCodingReviewSupport.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import {
  PythonProcessingClient,
  type ActivityAnalysisV2ClarificationQuestionDraft,
  type ActivityAnalysisV2GoalInput,
} from "../processing/pythonProcessingClient.js";
import type { ActivityLlmTokenLedgerService } from "../activity/activityLlmTokenLedgerService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type {
  ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
  ActivityPersistenceRecord,
} from "../activity/activityPersistence.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { ActivityAnalysisRunV2Repository } from "./activityAnalysisRunV2Repository.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "./activityAnalysisRunV2Persistence.js";
import { buildActivityAssessmentV2 } from "./activityAnalysisV2Assessment.js";
import { buildActivityAnalysisV2Diagnostics } from "./activityAnalysisV2Diagnostics.js";
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
import { validateAnswerAgainstQuestionOptions } from "./interpretationQuestionAnswerValidation.js";

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

// The V2 planner (analyst.py) only ever generates the six question codes
// below; epistemic_role_clarification/validated_scale_confirmation are
// generated exclusively by the dataset-preparation stage
// (interpretation_pipeline.py) and are resolved before V2 ever runs — they
// should never reach the planner's clarification-answer request. Narrowing
// here (rather than widening PlannerClarificationAnswer's questionCode) is
// deliberate: a prep-only code showing up on an activity's stored V2
// answers would indicate a bug upstream, not a new legitimate V2 code.
const PLANNER_QUESTION_CODES: readonly string[] = [
  "normalization_merge",
  "row_grain",
  "duplicate_identifier_resolution",
  "primary_status_field",
  "positive_status_values",
  "primary_date_field",
];

function toPlannerQuestionCode(
  questionCode: InterpretationQuestionCode | null | undefined,
): PlannerClarificationAnswer["questionCode"] {
  return questionCode && PLANNER_QUESTION_CODES.includes(questionCode)
    ? (questionCode as PlannerClarificationAnswer["questionCode"])
    : null;
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

function extractPlannerErrorLogContext(
  error: unknown,
): Record<string, unknown> {
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
    requestUrl: typeof details?.url === "string" ? details.url : undefined,
    requestPath: typeof details?.path === "string" ? details.path : undefined,
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
      qualitativeFindingIds: [...(toolCall.qualitativeFindingIds ?? [])],
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
      sourceColumnEpistemicRoles: (
        calculation.sourceColumnEpistemicRoles ?? []
      ).map((entry) => ({
        columnName: entry.columnName,
        epistemicRole: entry.epistemicRole ?? null,
      })),
      grain: calculation.grain,
      numerator: calculation.numerator ?? null,
      denominator: calculation.denominator ?? null,
      denominatorType: calculation.denominatorType,
      identifierColumn: calculation.identifierColumn ?? null,
      result: calculation.result,
    })),
    qualitativeFindings: (run.qualitativeFindings ?? []).map((finding) => ({
      findingId: finding.findingId,
      toolName: finding.toolName,
      label: finding.label,
      description: finding.description,
      themeOrCode: finding.themeOrCode,
      excerpts: finding.excerpts.map((excerpt) => ({
        sourceRowId: excerpt.sourceRowId ?? null,
        verbatimText: excerpt.verbatimText,
        sourceColumn: excerpt.sourceColumn,
      })),
      totalMatchingRows: finding.totalMatchingRows,
      excerptsReturned: finding.excerptsReturned,
      frequency: finding.frequency
        ? {
            count: finding.frequency.count,
            denominator: finding.frequency.denominator ?? null,
            denominatorType: finding.frequency.denominatorType ?? null,
          }
        : null,
      codingMethod: finding.codingMethod,
      reliabilitySignal: {
        missingValuePct: finding.reliabilitySignal.missingValuePct ?? null,
        raterCount: finding.reliabilitySignal.raterCount ?? null,
      },
      sourceUploadMetadataIds: [...finding.sourceUploadMetadataIds],
      sourceTableNames: [...finding.sourceTableNames],
      sourceColumns: [...finding.sourceColumns],
      sourceColumnEpistemicRoles: (
        finding.sourceColumnEpistemicRoles ?? []
      ).map((entry) => ({
        columnName: entry.columnName,
        epistemicRole: entry.epistemicRole ?? null,
      })),
      identifierColumn: finding.identifierColumn ?? null,
    })),
    assessment: run.assessment,
    diagnostics: run.diagnostics,
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

export class ActivityAnalysisV2Service {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
    private readonly qualitativeCodingReviewRepository: QualitativeCodingReviewRepository,
    private readonly activityAnalysisRunV2Repository: ActivityAnalysisRunV2Repository,
    private readonly activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationService: DatasetPreparationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly activityLlmTokenLedgerService: ActivityLlmTokenLedgerService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Shared by every Python call site in this service (planner, replans,
  // narrative/recommendation) so usage is recorded the same way regardless
  // of which call produced it, including calls that happen more than once
  // per run (the auto-resolved clarification replan loop).
  private async recordActivityAnalysisV2Usage(
    activityId: string,
    projectId: string,
    usage: LlmUsageSummary | null | undefined,
  ): Promise<void> {
    await this.projectLlmTokenLedgerService.recordUsage(
      projectId,
      usage,
      databaseSession,
    );
    await this.activityLlmTokenLedgerService.recordUsage(
      activityId,
      usage,
      databaseSession,
    );
  }

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
        draft.recommendedConfidence < PLANNER_CLARIFICATION_CONFIDENCE_THRESHOLD
      ) {
        return [];
      }
      // The planner (analyst.py) should only ever emit the six
      // PLANNER_QUESTION_CODES — epistemic_role_clarification/
      // validated_scale_confirmation are prep-stage-only and are always
      // resolved before V2 runs (see the comment on PLANNER_QUESTION_CODES).
      // If one shows up here anyway, treat it like any other anomaly:
      // don't silently auto-resolve it, let it surface as a normal pending
      // question for a human instead of guessing.
      if (
        draft.questionCode &&
        !PLANNER_QUESTION_CODES.includes(draft.questionCode)
      ) {
        return [];
      }

      return [
        buildPlannerClarificationAnswer({
          goalId: draft.goalId ?? null,
          prompt: draft.prompt,
          answeredValue: recommendedOption,
          questionCode: toPlannerQuestionCode(draft.questionCode),
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
        questionCode: toPlannerQuestionCode(answer.questionCode),
        targetTableName: answer.targetTableName ?? null,
        targetColumnName: answer.targetColumnName ?? null,
      }),
    );
  }

  private async generateNarrativeTexts(input: {
    activityId: string;
    projectId: string;
    activityName: string;
    language: "de" | "en";
    assessment: NonNullable<
      ActivityAnalysisRunV2PersistenceRecord["assessment"]
    >;
    calculations: ActivityAnalysisRunV2PersistenceRecord["calculations"];
    qualitativeFindings: ActivityAnalysisRunV2PersistenceRecord["qualitativeFindings"];
  }): Promise<{
    renderedSummary: string;
    recommendationText: string | null;
  }> {
    try {
      const { recommendationPolicy, actionableLimitations } =
        buildRecommendationPolicy(input.assessment);
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
                evidenceTensionFlag: goalAssessment.evidenceTensionFlag,
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
              sourceColumnEpistemicRoles:
                calculation.sourceColumnEpistemicRoles ?? [],
              grain: calculation.grain,
              numerator: calculation.numerator ?? null,
              denominator: calculation.denominator ?? null,
              denominatorType: calculation.denominatorType,
              identifierColumn: calculation.identifierColumn ?? null,
              result: calculation.result,
            })),
            qualitativeFindings: input.qualitativeFindings.map((finding) => ({
              findingId: finding.findingId,
              toolName: finding.toolName,
              label: finding.label,
              description: finding.description,
              themeOrCode: finding.themeOrCode,
              excerpts: finding.excerpts,
              totalMatchingRows: finding.totalMatchingRows,
              excerptsReturned: finding.excerptsReturned,
              frequency: finding.frequency,
              codingMethod: finding.codingMethod,
              reliabilitySignal: finding.reliabilitySignal,
              sourceTableNames: finding.sourceTableNames,
              sourceColumns: finding.sourceColumns,
              sourceColumnEpistemicRoles:
                finding.sourceColumnEpistemicRoles ?? [],
              identifierColumn: finding.identifierColumn ?? null,
            })),
          },
        );
      await this.recordActivityAnalysisV2Usage(
        input.activityId,
        input.projectId,
        response.llmUsage,
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
        recommendationText:
          recommendationText.length > 0 ? recommendationText : null,
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
        epistemicRole:
          | "identifier"
          | "temporal"
          | "validated_scale"
          | "metric_count"
          | "subjective_code"
          | "free_text"
          | "flag"
          | "categorical"
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
        const syntheticColumns =
          extractSyntheticQualitativeCodeColumnMetadata(table);
        const preparedTable = preparedDatasetTableWithSyntheticColumns(
          preparedTablesByName.get(tableName) ?? null,
          syntheticColumns,
        );
        const rows = readRowRecords(table.rows);
        const syntheticColumnByName = new Map(
          syntheticColumns.map((column) => [column.name, column]),
        );
        const fallbackColumnNames = Array.from(
          new Set([
            ...Object.keys(rows[0] ?? {}),
            ...syntheticColumns.map((column) => column.name),
          ]),
        );
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
              epistemicRole: column.epistemicRole,
            })) ??
            fallbackColumnNames.map((columnName) => {
              const syntheticColumn =
                syntheticColumnByName.get(columnName) ?? null;
              return {
                name: columnName,
                role: syntheticColumn ? ("other" as const) : null,
                inferredType: syntheticColumn?.inferredType ?? null,
                epistemicRole: syntheticColumn?.epistemicRole ?? null,
              };
            }),
        };
      });
    });
  }

  /**
   * The synchronous precondition gate for an ActivityAnalystV2 run: auth,
   * evidence load, and the three 409s that must reject before any Python
   * call is made. Called both as the synchronous pre-flight check (so a
   * caller gets an immediate 4xx instead of a queued job that only fails
   * once claimed) and again, defensively, at the top of
   * previewActivityAnalysis itself right before the real work — state can
   * drift between when a job is enqueued and when it's actually claimed
   * and run (e.g. new evidence uploaded in the interim), so re-validating
   * at execution time is the correct choice, not just a formality.
   */
  async assertReadyForV2Run(userId: string, activityId: string) {
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

    const qualitativeCodingReviewStatuses = await Promise.all([
      this.interpretationResultRepository.findLatestByUploadMetadataIds(
        evidenceSnapshot.evidence.map((item) => item.uploadMetadataId),
        databaseSession,
      ),
      Promise.all(
        evidenceSnapshot.evidence.map((item) =>
          this.qualitativeCodingReviewRepository.findByUploadMetadataId(
            item.uploadMetadataId,
            databaseSession,
          ),
        ),
      ),
    ]);
    const interpretationResultsByUploadMetadataId = new Map(
      qualitativeCodingReviewStatuses[0].map((result) => [
        result.uploadMetadataId,
        result,
      ]),
    );
    const qualitativeCodingReviewByUploadMetadataId = new Map(
      evidenceSnapshot.evidence.map((item, index) => [
        item.uploadMetadataId,
        qualitativeCodingReviewStatuses[1][index] ?? null,
      ]),
    );
    const pendingQualitativeCodingReviewUploads =
      evidenceSnapshot.evidence.flatMap((item) => {
        const interpretationResult =
          interpretationResultsByUploadMetadataId.get(item.uploadMetadataId) ??
          null;
        const requirementStatus = qualitativeCodingReviewRequirementStatus(
          interpretationResult?.datasetProfile ?? null,
          qualitativeCodingReviewByUploadMetadataId.get(
            item.uploadMetadataId,
          ) ?? null,
        );
        if (requirementStatus !== "required_pending") {
          return [];
        }
        return [
          {
            uploadMetadataId: item.uploadMetadataId,
            originalFileName: item.originalFileName,
          },
        ];
      });
    if (pendingQualitativeCodingReviewUploads.length > 0) {
      throw new AppError(
        "Every current evidence file that still requires qualitative coding review must be approved before ActivityAnalystV2 preview is available.",
        409,
        "activity_analysis_v2_qualitative_review_required",
        { pendingQualitativeCodingReviewUploads },
      );
    }

    return { activity, project, evidenceSnapshot };
  }

  async previewActivityAnalysis(
    userId: string,
    activityId: string,
    language: "de" | "en" = "de",
  ): Promise<ActivityAnalysisRunV2Record> {
    const runStartedAt = Date.now();
    const { activity, project, evidenceSnapshot } =
      await this.assertReadyForV2Run(userId, activityId);

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
    // Needed so a planner-call failure (network error, timeout, malformed
    // response) can still show the previously known clarification
    // questions instead of wiping them to an empty list — see the
    // exception handler below.
    const previousRun =
      await this.activityAnalysisRunV2Repository.findLatestByActivityId(
        activityId,
        databaseSession,
      );
    let plannerClarificationAnswers =
      this.buildPlannerClarificationAnswers(activity);

    const planWithClarificationAnswers = async () => {
      const response = await this.pythonProcessingClient.planActivityAnalysisV2(
        {
          activityId: activity.id,
          activityName: activity.name,
          language,
          goals,
          evidenceTables,
          clarificationAnswers: plannerClarificationAnswers,
          runLimits: PHASE_1_RUN_LIMITS,
        },
      );
      // Recorded per call, not once per run — this can be invoked multiple
      // times by the auto-resolved clarification replan loop below, and
      // each call is separately billed.
      await this.recordActivityAnalysisV2Usage(
        activity.id,
        project.id,
        response.llmUsage,
      );
      return response;
    };

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
      // The planner call threw before producing a new plan, so there are no
      // fresh drafts to build a question list from. Re-derive from the
      // previous run's questions (re-merged against the answers persisted
      // so far, including whichever one was just answered) instead of
      // wiping the list to empty — otherwise every remaining unanswered
      // question becomes permanently unreachable: the next PATCH looks it
      // up in *this* failed run and 404s, since it's no longer there.
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
          clarificationQuestions: this.buildClarificationQuestions(
            previousRun?.clarificationQuestions ?? [],
            persistedClarificationAnswers,
            new Set(),
          ),
          toolCallTrace: [],
          calculations: [],
          qualitativeFindings: [],
          assessment: null,
          diagnostics,
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
          qualitativeFindings: [],
          assessment: null,
          diagnostics,
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
          qualitativeFindings: [],
          assessment: null,
          diagnostics,
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
          qualitativeFindings: [],
          assessment: null,
          diagnostics,
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
            goalId: toolRequest.goalId,
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
              qualitativeFindings: [],
            };
      const assessmentResult = buildActivityAssessmentV2({
        language,
        goals: plannerResponse.goalPlans,
        plannedToolRequests: plannerResponse.toolRequests,
        toolCallTrace: execution.toolCallTrace,
        calculations: execution.calculations,
        qualitativeFindings: execution.qualitativeFindings,
        limitations: plannerResponse.limitations,
      });

      // Tool execution and assessment above are already computed (and, for
      // tool execution, already paid for) by this point. Narrative
      // generation gets its own try/catch so a failure here persists that
      // work instead of discarding it — the outer catch below only knows
      // how to recover state from a failed tool executor's error, not from
      // a narrative-generation failure.
      try {
        const narrative = await this.generateNarrativeTexts({
          activityId: activity.id,
          projectId: project.id,
          activityName: activity.name,
          language,
          assessment: assessmentResult.assessment,
          calculations: execution.calculations,
          qualitativeFindings: execution.qualitativeFindings,
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
            qualitativeFindings: execution.qualitativeFindings,
            assessment: assessmentResult.assessment,
            diagnostics,
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
          },
          "ActivityAnalystV2 shadow preview completed",
        );
      } catch (narrativeError) {
        const diagnostics = buildActivityAnalysisV2Diagnostics({
          goals,
          evidenceCount: evidenceSnapshot.evidence.length,
          plannedToolRequestCount: plannerResponse.toolRequests.length,
          executedToolCallCount: execution.toolCallTrace.length,
          calculationCount: execution.calculations.length,
          validation: assessmentResult.validation,
          renderedSummary: null,
          assessment: assessmentResult.assessment,
        });
        run = await this.activityAnalysisRunV2Repository.create(
          {
            organizationId: project.organizationId,
            projectId: project.id,
            activityId: activity.id,
            activityName: activity.name,
            phase: "phase_4_rendering",
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
            toolCallTrace: execution.toolCallTrace,
            calculations: execution.calculations,
            qualitativeFindings: execution.qualitativeFindings,
            assessment: assessmentResult.assessment,
            diagnostics,
            renderedSummary: null,
            recommendationText: null,
            validation: assessmentResult.validation,
            errorMessage:
              narrativeError instanceof Error
                ? narrativeError.message
                : "ActivityAnalystV2 narrative generation failed.",
          },
          databaseSession,
        );
        this.logger.error(
          {
            activityId: activity.id,
            error: narrativeError,
          },
          "ActivityAnalystV2 narrative generation failed after successful tool execution",
        );
      }
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
      const qualitativeFindings =
        error &&
        typeof error === "object" &&
        "qualitativeFindings" in error &&
        Array.isArray(error.qualitativeFindings)
          ? (error.qualitativeFindings as ActivityAnalysisRunV2PersistenceRecord["qualitativeFindings"])
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
          qualitativeFindings,
          assessment: null,
          diagnostics,
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
        },
        "ActivityAnalystV2 shadow preview failed",
      );
    }

    return mapActivityAnalysisRunV2Record(run);
  }

  private async persistClarificationAnswer(
    activityId: string,
    userId: string,
    question: InterpretationQuestion,
    answeredValue: string,
  ): Promise<void> {
    await this.activityRepository.upsertClarificationAnswer(
      activityId,
      {
        questionId: question.id,
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
  }

  /**
   * Validates and persists a single clarification answer. Does NOT trigger
   * a replan — that used to happen inline here (a full previewActivityAnalysis
   * call), but replanning is LLM-round-trip-bound work that now runs inside
   * an activity_analysis_v2 processing job instead of a live HTTP request
   * (see activityAnalysisWorker.ts). Persisting the answer stays synchronous
   * (fast, deterministic, Mongo-only) so the caller (InterpretationController)
   * can create that job immediately afterward with the answer already
   * durably saved.
   */
  async answerClarificationQuestion(
    userId: string,
    activityId: string,
    questionId: string,
    answeredValue: string,
  ): Promise<void> {
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

    validateAnswerAgainstQuestionOptions(
      question,
      answeredValue,
      "activity_analysis_v2_question_invalid_answer",
    );
    await this.persistClarificationAnswer(
      activityId,
      userId,
      question,
      answeredValue,
    );
  }

  /**
   * Validates and persists a batch of clarification answers in one call, so
   * a run with several outstanding questions only triggers one replan job
   * instead of one per question — each replan re-plans every goal for the
   * activity, so answering N questions one at a time would cost N full
   * replans, most of them wasted because the other questions were still
   * unanswered anyway. Does NOT trigger the replan itself; see
   * answerClarificationQuestion's doc comment for why.
   */
  async answerClarificationQuestions(
    userId: string,
    activityId: string,
    answers: Array<{ questionId: string; answeredValue: string }>,
  ): Promise<void> {
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

    const questionById = new Map(
      latestRun.clarificationQuestions.map((question) => [
        question.id,
        question,
      ]),
    );

    // Validate every answer before persisting any of them — a batch must
    // not partially apply, or the user is left guessing which of their
    // selections actually took effect.
    const resolvedAnswers = answers.map((answer) => {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new AppError(
          "This ActivityAnalystV2 clarification question was not found.",
          404,
          "activity_analysis_v2_question_not_found",
          { questionId: answer.questionId },
        );
      }
      validateAnswerAgainstQuestionOptions(
        question,
        answer.answeredValue,
        "activity_analysis_v2_question_invalid_answer",
      );
      return { question, answeredValue: answer.answeredValue };
    });

    for (const { question, answeredValue } of resolvedAnswers) {
      await this.persistClarificationAnswer(
        activityId,
        userId,
        question,
        answeredValue,
      );
    }
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
