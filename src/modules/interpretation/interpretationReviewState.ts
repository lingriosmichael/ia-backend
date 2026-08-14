import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  InterpretationQuestionCode,
  InterpretationQuestionKind,
  InterpretationQuestionStatus,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";

const FIRST_LAYER_BLOCKING_QUESTION_CODES = new Set<InterpretationQuestionCode>(
  [
    "normalization_merge",
    "row_grain",
    "duplicate_identifier_resolution",
    "epistemic_role_clarification",
    "validated_scale_confirmation",
  ],
);

type ReviewQuestion = {
  isBlocking?: boolean | null;
  kind: InterpretationQuestionKind;
  status: InterpretationQuestionStatus;
  questionCode?: InterpretationQuestionCode | null;
};

type ReviewResult = {
  questions: ReviewQuestion[];
};

export function isBlockingQuestion(question: {
  isBlocking?: boolean | null;
  kind: InterpretationQuestionKind;
  questionCode?: InterpretationQuestionCode | null;
}): boolean {
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
        isBlockingQuestion(question) && question.status === "pending",
    ),
  );
}

export async function clearActivityInterpretationAcknowledgmentIfPresent(
  activityRepository: ActivityRepository,
  activityId: string,
  session: DatabaseSession,
): Promise<void> {
  await clearActivityAiKnowledgeStateIfPresent(
    activityRepository,
    activityId,
    session,
  );
}

export async function clearActivityAiKnowledgeStateIfPresent(
  activityRepository: ActivityRepository,
  activityId: string,
  session: DatabaseSession,
): Promise<{
  clearedAcknowledgment: boolean;
  clearedAiKnowledge: boolean;
  clearedClarificationAnswers: boolean;
}> {
  const activity = await activityRepository.findById(activityId, session);

  if (!activity) {
    return {
      clearedAcknowledgment: false,
      clearedAiKnowledge: false,
      clearedClarificationAnswers: false,
    };
  }

  const clearedAcknowledgment = Boolean(
    activity.interpretationAcknowledgedAt ||
    activity.interpretationAcknowledgedById,
  );
  const clearedAiKnowledge = Boolean(activity.aiKnowledgeSnapshot);
  const clearedClarificationAnswers = Boolean(
    activity.activityAnalysisV2ClarificationAnswers &&
    activity.activityAnalysisV2ClarificationAnswers.length > 0,
  );

  if (
    !clearedAcknowledgment &&
    !clearedAiKnowledge &&
    !clearedClarificationAnswers
  ) {
    return {
      clearedAcknowledgment,
      clearedAiKnowledge,
      clearedClarificationAnswers,
    };
  }

  await activityRepository.update(
    activityId,
    {
      interpretationAcknowledgedAt: clearedAcknowledgment ? null : undefined,
      interpretationAcknowledgedById: clearedAcknowledgment ? null : undefined,
      aiKnowledgeSnapshot: null,
      activityAnalysisV2ClarificationAnswers: [],
    },
    session,
  );

  return {
    clearedAcknowledgment,
    clearedAiKnowledge,
    clearedClarificationAnswers,
  };
}
