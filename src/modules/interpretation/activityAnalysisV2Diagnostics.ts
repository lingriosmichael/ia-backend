import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";

interface GoalDefinition {
  goalType: "output";
}

// Optional: the pre-planner-call failure branches (planner call threw, or
// timed out before a plan was even produced) have none of this data yet,
// so it's fine to omit and get an all-zero contextExtraction block rather
// than force every call site to fabricate values it doesn't have.
interface BuildActivityAnalysisV2DiagnosticsContextExtractionInput {
  totalCategoricalColumnsSeen: number;
  contextCandidatesProposed: number;
  contextCandidatesExcludedByReferencedStrings: number;
  contextCandidatesExcludedByMissingEpistemicRole: number;
  contextCandidatesMaterialized: number;
  preparedTableFallbackTableCount: number;
}

interface BuildActivityAnalysisV2DiagnosticsInput {
  goals: GoalDefinition[];
  evidenceCount: number;
  plannedToolRequestCount: number;
  executedToolCallCount: number;
  calculationCount: number;
  validation: ActivityAnalysisRunV2Validation;
  assessment: ActivityAssessmentV2 | null;
  contextExtraction?: BuildActivityAnalysisV2DiagnosticsContextExtractionInput;
}

const EMPTY_CONTEXT_EXTRACTION_DIAGNOSTICS: BuildActivityAnalysisV2DiagnosticsContextExtractionInput =
  {
    totalCategoricalColumnsSeen: 0,
    contextCandidatesProposed: 0,
    contextCandidatesExcludedByReferencedStrings: 0,
    contextCandidatesExcludedByMissingEpistemicRole: 0,
    contextCandidatesMaterialized: 0,
    preparedTableFallbackTableCount: 0,
  };

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
    contextExtraction:
      input.contextExtraction ?? EMPTY_CONTEXT_EXTRACTION_DIAGNOSTICS,
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
