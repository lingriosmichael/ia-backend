import { AppError } from "../../shared/errors/appError.js";

interface AnswerableQuestion {
  id: string;
  options: string[] | null;
}

// Shared by both clarification-question flows that let a user answer a
// single_choice question — ActivityAnalystV2's run-level questions
// (activityAnalysisV2Service.ts) and the per-InterpretationResult dataset
// questions (interpretationService.ts). errorCode stays call-site-specific
// so each flow's API contract keeps its own distinguishable error code.
export function validateAnswerAgainstQuestionOptions(
  question: AnswerableQuestion,
  answeredValue: string,
  errorCode: string,
): void {
  if (
    question.options &&
    question.options.length > 0 &&
    !question.options.includes(answeredValue)
  ) {
    throw new AppError(
      "This answer is not one of the options offered for this clarification question.",
      422,
      errorCode,
      { questionId: question.id, allowedOptions: question.options },
    );
  }
}
