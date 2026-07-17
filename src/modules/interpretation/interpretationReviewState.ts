import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  InterpretationQuestionKind,
  InterpretationQuestionStatus,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";

type ReviewQuestion = {
  isBlocking?: boolean | null;
  kind: InterpretationQuestionKind;
  status: InterpretationQuestionStatus;
};

type ReviewResult = {
  questions: ReviewQuestion[];
};

export function isBlockingQuestion(question: {
  isBlocking?: boolean | null;
  kind: InterpretationQuestionKind;
}): boolean {
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
}> {
  const activity = await activityRepository.findById(activityId, session);

  if (!activity) {
    return {
      clearedAcknowledgment: false,
      clearedAiKnowledge: false,
    };
  }

  const clearedAcknowledgment = Boolean(
    activity.interpretationAcknowledgedAt ||
    activity.interpretationAcknowledgedById,
  );
  const clearedAiKnowledge = Boolean(activity.aiKnowledgeSnapshot);

  if (!clearedAcknowledgment && !clearedAiKnowledge) {
    return { clearedAcknowledgment, clearedAiKnowledge };
  }

  await activityRepository.update(
    activityId,
    {
      interpretationAcknowledgedAt: clearedAcknowledgment ? null : undefined,
      interpretationAcknowledgedById: clearedAcknowledgment ? null : undefined,
      aiKnowledgeSnapshot: null,
    },
    session,
  );

  return { clearedAcknowledgment, clearedAiKnowledge };
}
