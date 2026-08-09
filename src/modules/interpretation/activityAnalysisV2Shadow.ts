import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2Diagnostics,
  ActivityAnalysisV2ShadowComparison,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";

interface GoalDefinition {
  goalType: "output" | "outcome";
}

interface V1ActivityAiKnowledgeSnapshotLike {
  generatedAt?: Date | null;
  interpretedEvidenceCount?: number | null;
  totalEvidenceCount?: number | null;
  summaryText?: string | null;
  insights?: unknown[] | null;
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

interface BuildActivityAnalysisV2ShadowComparisonInput {
  hasOutcomeGoals: boolean;
  currentEvidenceCount: number;
  validation: ActivityAnalysisRunV2Validation;
  renderedSummary: string | null;
  assessment: ActivityAssessmentV2 | null;
  v1Snapshot: V1ActivityAiKnowledgeSnapshotLike | null;
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

function hasOutcomeSection(renderedSummary: string | null): boolean {
  if (!renderedSummary) {
    return false;
  }
  return /(^|\n)(Wirkung|Outcomes)(\n|$)/m.test(renderedSummary);
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

export function buildActivityAnalysisV2ShadowComparison(
  input: BuildActivityAnalysisV2ShadowComparisonInput,
): ActivityAnalysisV2ShadowComparison {
  const notes: string[] = [];
  const noOutcomeSectionOmitted =
    !input.hasOutcomeGoals && !hasOutcomeSection(input.renderedSummary);
  const v1Snapshot = input.v1Snapshot;

  if (input.validation.status === "failed") {
    notes.push(
      "The V2 shadow run failed validation and should be reviewed before comparing it to V1 output.",
    );
    return {
      status: "v2_invalid",
      notes,
      v1GeneratedAt: v1Snapshot?.generatedAt?.toISOString() ?? null,
      v1InterpretedEvidenceCount: v1Snapshot?.interpretedEvidenceCount ?? null,
      v1TotalEvidenceCount: v1Snapshot?.totalEvidenceCount ?? null,
      v1InsightCount: v1Snapshot?.insights?.length ?? null,
      v2GoalAssessmentCount: input.assessment?.goalAssessments.length ?? 0,
      noOutcomeSectionOmitted,
    };
  }

  if (!v1Snapshot) {
    notes.push(
      "No V1 AI knowledge snapshot exists yet, so this V2 run cannot be compared against a current production summary.",
    );
    return {
      status: "v1_missing",
      notes,
      v1GeneratedAt: null,
      v1InterpretedEvidenceCount: null,
      v1TotalEvidenceCount: null,
      v1InsightCount: null,
      v2GoalAssessmentCount: input.assessment?.goalAssessments.length ?? 0,
      noOutcomeSectionOmitted,
    };
  }

  if (v1Snapshot.totalEvidenceCount !== input.currentEvidenceCount) {
    notes.push(
      `V1 totalEvidenceCount (${v1Snapshot.totalEvidenceCount ?? "n/a"}) does not match the current evidence count used by V2 (${input.currentEvidenceCount}).`,
    );
  }

  if (v1Snapshot.interpretedEvidenceCount !== input.currentEvidenceCount) {
    notes.push(
      `V1 interpretedEvidenceCount (${v1Snapshot.interpretedEvidenceCount ?? "n/a"}) does not match the current evidence count used by V2 (${input.currentEvidenceCount}).`,
    );
  }

  if (
    !input.hasOutcomeGoals &&
    hasOutcomeSection(v1Snapshot.summaryText ?? null)
  ) {
    notes.push(
      "The activity has no outcome goals, but the V1 summary still contains an outcome section.",
    );
  }

  if (
    input.assessment?.goalAssessments.some(
      (goalAssessment) =>
        goalAssessment.assessmentStatus === "requires_clarification" ||
        goalAssessment.assessmentStatus === "requires_capability",
    ) ??
    false
  ) {
    notes.push(
      "At least one V2 goal still requires clarification or a missing deterministic capability, so the shadow result should be reviewed before relying on it.",
    );
  }

  return {
    status: notes.length > 0 ? "review_recommended" : "shadow_ready",
    notes:
      notes.length > 0
        ? notes
        : [
            "V2 completed successfully and no immediate high-signal mismatch with the current V1 snapshot was detected.",
          ],
    v1GeneratedAt: v1Snapshot.generatedAt?.toISOString() ?? null,
    v1InterpretedEvidenceCount: v1Snapshot.interpretedEvidenceCount ?? null,
    v1TotalEvidenceCount: v1Snapshot.totalEvidenceCount ?? null,
    v1InsightCount: v1Snapshot.insights?.length ?? null,
    v2GoalAssessmentCount: input.assessment?.goalAssessments.length ?? 0,
    noOutcomeSectionOmitted,
  };
}
