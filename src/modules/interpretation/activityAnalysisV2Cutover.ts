import type {
  ActivityAnalysisV2CutoverReadiness,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisV2ShadowComparison,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";

export function buildActivityAnalysisV2CutoverReadiness(input: {
  diagnostics: ActivityAnalysisV2Diagnostics;
  shadowComparison: ActivityAnalysisV2ShadowComparison;
  validation: ActivityAnalysisRunV2Validation;
}): ActivityAnalysisV2CutoverReadiness {
  const assessedGoalCount =
    input.diagnostics.goalStatusCounts.achieved +
    input.diagnostics.goalStatusCounts.notAchieved +
    input.diagnostics.goalStatusCounts.evidenceCompiled +
    input.diagnostics.goalStatusCounts.requiresClarification +
    input.diagnostics.goalStatusCounts.requiresCapability;

  const criteria: ActivityAnalysisV2CutoverReadiness["criteria"] = [
    {
      key: "validation_passed",
      passed: input.validation.status === "passed",
      detail:
        input.validation.status === "passed"
          ? "The run passed structured validation."
          : "The run failed structured validation.",
    },
    {
      key: "all_goals_assessed",
      passed:
        input.diagnostics.goalCount > 0 &&
        input.diagnostics.goalCount === assessedGoalCount,
      detail: `Assessed ${assessedGoalCount} of ${input.diagnostics.goalCount} goals.`,
    },
    {
      key: "summary_rendered",
      passed: input.diagnostics.renderedSummaryCharacterCount > 0,
      detail:
        input.diagnostics.renderedSummaryCharacterCount > 0
          ? `Rendered summary contains ${input.diagnostics.renderedSummaryCharacterCount} characters.`
          : "No rendered summary was produced.",
    },
    {
      key: "shadow_comparison_clear",
      passed: input.shadowComparison.status === "shadow_ready",
      detail: `Shadow comparison status is ${input.shadowComparison.status}.`,
    },
    {
      key: "no_outcome_section_omitted",
      passed:
        input.diagnostics.outcomeGoalCount > 0 ||
        input.shadowComparison.noOutcomeSectionOmitted,
      detail:
        input.diagnostics.outcomeGoalCount > 0
          ? "Outcome goals exist, so an outcome section is allowed."
          : input.shadowComparison.noOutcomeSectionOmitted
            ? "No outcome goals exist and no outcome section was rendered."
            : "No outcome goals exist, but an outcome section mismatch was detected.",
    },
  ];

  return {
    status: criteria.every((criterion) => criterion.passed)
      ? "eligible"
      : "not_eligible",
    criteria,
  };
}
