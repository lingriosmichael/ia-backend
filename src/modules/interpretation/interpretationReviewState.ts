import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfile,
  InterpretationQuestionCode,
  InterpretationQuestionKind,
  InterpretationQuestionStatus,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import { shouldIgnoreInterpretationQuestion } from "../../shared/utils/interpretationQuestionFilters.js";

const FIRST_LAYER_BLOCKING_QUESTION_CODES = new Set<InterpretationQuestionCode>(
  [
    "normalization_merge",
    "row_grain",
    "duplicate_identifier_resolution",
    "epistemic_role_clarification",
    "validated_scale_confirmation",
    "cohort_tag",
    "pairing_group_key",
    "pairing_group_role",
  ],
);

type ReviewQuestion = {
  isBlocking?: boolean | null;
  kind: InterpretationQuestionKind;
  status: InterpretationQuestionStatus;
  questionCode?: InterpretationQuestionCode | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
};

type ReviewResult = {
  datasetProfile?: DatasetProfile | null;
  privacySafePayload?: Record<string, unknown> | null;
  questions: ReviewQuestion[];
};

export function isBlockingQuestion(
  question: {
    isBlocking?: boolean | null;
    kind: InterpretationQuestionKind;
    questionCode?: InterpretationQuestionCode | null;
    targetTableName?: string | null;
    targetColumnName?: string | null;
  },
  context?: {
    datasetProfile?: DatasetProfile | null;
    privacySafePayload?: Record<string, unknown> | null;
  },
): boolean {
  if (shouldIgnoreInterpretationQuestion(question, context)) {
    return false;
  }

  if (question.questionCode) {
    return (
      FIRST_LAYER_BLOCKING_QUESTION_CODES.has(question.questionCode) &&
      (question.isBlocking ?? question.kind !== "free_text")
    );
  }
  return question.isBlocking ?? question.kind !== "free_text";
}

export function hasPendingBlockingQuestions(results: ReviewResult[]): boolean {
  return results.some((result) =>
    result.questions.some(
      (question) =>
        isBlockingQuestion(question, {
          datasetProfile: result.datasetProfile,
          privacySafePayload: result.privacySafePayload,
        }) && question.status === "pending",
    ),
  );
}

export async function clearActivityInterpretationAcknowledgmentIfPresent(
  activityRepository: ActivityRepository,
  activityId: string,
  session: DatabaseSession,
): Promise<void> {
  await clearActivityInterpretationReviewStateIfPresent(
    activityRepository,
    activityId,
    session,
  );
}

export async function clearActivityInterpretationReviewStateIfPresent(
  activityRepository: ActivityRepository,
  activityId: string,
  session: DatabaseSession,
): Promise<{
  clearedAcknowledgment: boolean;
  clearedClarificationAnswers: boolean;
}> {
  const activity = await activityRepository.findById(activityId, session);

  if (!activity) {
    return {
      clearedAcknowledgment: false,
      clearedClarificationAnswers: false,
    };
  }

  const clearedAcknowledgment = Boolean(
    activity.interpretationAcknowledgedAt ||
    activity.interpretationAcknowledgedById,
  );
  const clearedClarificationAnswers = Boolean(
    activity.activityAnalysisV2ClarificationAnswers &&
    activity.activityAnalysisV2ClarificationAnswers.length > 0,
  );

  if (!clearedAcknowledgment && !clearedClarificationAnswers) {
    return {
      clearedAcknowledgment,
      clearedClarificationAnswers,
    };
  }

  await activityRepository.update(
    activityId,
    {
      interpretationAcknowledgedAt: clearedAcknowledgment ? null : undefined,
      interpretationAcknowledgedById: clearedAcknowledgment ? null : undefined,
      activityAnalysisV2ClarificationAnswers: [],
    },
    session,
  );

  return {
    clearedAcknowledgment,
    clearedClarificationAnswers,
  };
}
