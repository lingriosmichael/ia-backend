import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";

interface GoalDefinition {
  goalType: "output";
}

interface BuildActivityAnalysisV2DiagnosticsInput {
  goals: GoalDefinition[];
  evidenceCount: number;
  plannedToolRequestCount: number;
  executedToolCallCount: number;
  calculationCount: number;
  validation: ActivityAnalysisRunV2Validation;
  assessment: ActivityAssessmentV2 | null;
}

export function buildActivityAnalysisV2Diagnostics(
  input: BuildActivityAnalysisV2DiagnosticsInput,
): ActivityAnalysisV2Diagnostics {
  return {
    goalCount: input.goals.length,
    outputGoalCount: input.goals.length,
    evidenceCount: input.evidenceCount,
    plannedToolRequestCount: input.plannedToolRequestCount,
    executedToolCallCount: input.executedToolCallCount,
    calculationCount: input.calculationCount,
    validationIssueCount: input.validation.issues.length,
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
