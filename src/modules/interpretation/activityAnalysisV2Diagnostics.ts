import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";

interface GoalDefinition {
  goalType: "output" | "outcome";
}

interface BuildActivityAnalysisV2DiagnosticsInput {
  goals: GoalDefinition[];
  evidenceCount: number;
  plannedToolRequestCount: number;
  executedToolCallCount: number;
  calculationCount: number;
  validation: ActivityAnalysisRunV2Validation;
  renderedSummary: string | null;
  assessment: ActivityAssessmentV2 | null;
}

function countRenderedSections(renderedSummary: string | null): number {
  if (!renderedSummary) {
    return 0;
  }
  return renderedSummary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      ["Ergebnisse", "Wirkung", "Outputs", "Outcomes"].includes(line),
    ).length;
}

export function buildActivityAnalysisV2Diagnostics(
  input: BuildActivityAnalysisV2DiagnosticsInput,
): ActivityAnalysisV2Diagnostics {
  const outputGoalCount = input.goals.filter(
    (goal) => goal.goalType === "output",
  ).length;
  const outcomeGoalCount = input.goals.length - outputGoalCount;

  return {
    goalCount: input.goals.length,
    outputGoalCount,
    outcomeGoalCount,
    evidenceCount: input.evidenceCount,
    plannedToolRequestCount: input.plannedToolRequestCount,
    executedToolCallCount: input.executedToolCallCount,
    calculationCount: input.calculationCount,
    validationIssueCount: input.validation.issues.length,
    renderedSummarySectionCount: countRenderedSections(input.renderedSummary),
    renderedSummaryCharacterCount: input.renderedSummary?.length ?? 0,
    goalStatusCounts: {
      achieved:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) => goalAssessment.assessmentStatus === "achieved",
        ).length ?? 0,
      notAchieved:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "not_achieved",
        ).length ?? 0,
      evidenceCompiled:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "evidence_compiled",
        ).length ?? 0,
      qualitativeEvidenceOnly:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "qualitative_evidence_only",
        ).length ?? 0,
      mixedEvidence:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "mixed_evidence",
        ).length ?? 0,
      requiresClarification:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "requires_clarification",
        ).length ?? 0,
      requiresCapability:
        input.assessment?.goalAssessments.filter(
          (goalAssessment) =>
            goalAssessment.assessmentStatus === "requires_capability",
        ).length ?? 0,
    },
  };
}
