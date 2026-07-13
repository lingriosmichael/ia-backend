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
  const activity = await activityRepository.findById(activityId, session);

  if (
    !activity ||
    (!activity.interpretationAcknowledgedAt &&
      !activity.interpretationAcknowledgedById)
  ) {
    return;
  }

  await activityRepository.update(
    activityId,
    {
      interpretationAcknowledgedAt: null,
      interpretationAcknowledgedById: null,
    },
    session,
  );
}
