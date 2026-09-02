import { AppError } from "../../shared/errors/appError.js";
import type {
  ClarificationQuestionOption,
  InterpretationQuestionKind,
} from "../../shared/contracts.js";

interface AnswerableQuestion {
  id: string;
  kind: InterpretationQuestionKind;
  userFacingOptions: ClarificationQuestionOption[] | null;
}

// New frontend submissions serialize multi_choice selections as a JSON
// string array (e.g. `["yes","no, with conditions"]`) so a literal comma
// inside one option value is unambiguous. Legacy comma-joined answers are
// still accepted for already-persisted records.
function splitMultiChoiceAnswer(answeredValue: string): string[] {
  const trimmedAnswer = answeredValue.trim();
  if (trimmedAnswer.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedAnswer);
      return Array.isArray(parsed)
        ? parsed
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return answeredValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// Shared by both clarification-question flows that let a user answer a
// single_choice or multi_choice question — ActivityAnalystV2's run-level
// questions (activityAnalysisV2Service.ts) and the per-InterpretationResult
// dataset questions (interpretationService.ts). errorCode stays
// call-site-specific so each flow's API contract keeps its own
// distinguishable error code.
export function validateAnswerAgainstQuestionOptions(
  question: AnswerableQuestion,
  answeredValue: string,
  errorCode: string,
): void {
  if (!question.userFacingOptions || question.userFacingOptions.length === 0) {
    return;
  }

  const allowedValues = new Set(
    question.userFacingOptions.map((option) => option.value),
  );
  const submittedValues =
    question.kind === "multi_choice"
      ? splitMultiChoiceAnswer(answeredValue)
      : [answeredValue];

  const isValid =
    submittedValues.length > 0 &&
    submittedValues.every((value) => allowedValues.has(value));

  if (!isValid) {
    throw new AppError(
      "This answer is not one of the options offered for this clarification question.",
      422,
      errorCode,
      {
        questionId: question.id,
        allowedOptions: question.userFacingOptions.map(
          (option) => option.value,
        ),
      },
    );
  }
}
