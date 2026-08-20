import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2GoalAssessmentRecord,
} from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";

// Shared fixture builders for projectImpactStory test files — kept out of
// any single *.test.ts file so projectImpactStoryAssembly.test.ts,
// projectImpactStoryCatalog.test.ts, and
// projectImpactStoryChartPlanExecution.test.ts build V2 run fixtures the
// same way instead of each hand-rolling a slightly different one.

export function buildCalculation(
  id: string,
  overrides?: Partial<ActivityAnalysisV2CalculationRecord>,
): ActivityAnalysisV2CalculationRecord {
  return {
    calculationId: id,
    toolName: "count_rows",
    label: "Personen erreicht",
    description:
      "Anzahl der Personen, die durch die Aktivität erreicht wurden.",
    formula: null,
    value: 127,
    unit: "rows",
    sourceUploadMetadataIds: [],
    sourceTableNames: [],
    sourceColumns: [],
    result: {},
    ...overrides,
  };
}

export function buildGoalAssessment(
  calculationIds: string[],
  overrides?: Partial<ActivityAnalysisV2GoalAssessmentRecord>,
): ActivityAnalysisV2GoalAssessmentRecord {
  return {
    goalId: "goal-1",
    goalType: "output",
    goalText: "Reach youth",
    evaluationMode: "numeric_target",
    plannerStatus: "planned",
    assessmentStatus: "achieved",
    rationale: "",
    findingText: "",
    missingCapabilities: [],
    supportingCalculationIds: calculationIds,
    supportingQualitativeFindingIds: [],
    evidenceTensionFlag: false,
    measuredValue: null,
    targetValue: null,
    comparison: null,
    achieved: true,
    ...overrides,
  };
}

export function buildRun(
  id: string,
  activityId: string,
  calculations: ActivityAnalysisV2CalculationRecord[],
  goalAssessments: ActivityAnalysisV2GoalAssessmentRecord[],
  overrides?: Partial<ActivityAnalysisRunV2PersistenceRecord>,
): ActivityAnalysisRunV2PersistenceRecord {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    activityId,
    activityName: "Activity",
    phase: "final",
    status: "completed",
    goalsSnapshot: {
      activityType: null,
      objectives: null,
      output: null,
    },
    evidence: [
      {
        uploadMetadataId: `upload-${activityId}`,
        privacySafeRepresentationId: `privacy-${activityId}`,
        logicalEvidenceId: `logical-${activityId}`,
        versionNumber: 1,
        originalFileName: "file.csv",
        evidenceModality: null,
        uploadedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    runLimits: {
      maxToolCalls: 24,
      maxLlmIterations: 5,
      timeoutMs: 330000,
      maxEvidenceItems: 40,
    },
    clarificationQuestions: [],
    toolCallTrace: [],
    calculations,
    contextCatalogEntries: [],
    qualitativeFindings: [],
    assessment: { goalAssessments, limitations: [] },
    diagnostics: {
      goalCount: goalAssessments.length,
      outputGoalCount: goalAssessments.length,
      evidenceCount: 1,
      plannedToolRequestCount: calculations.length,
      executedToolCallCount: calculations.length,
      calculationCount: calculations.length,
      validationIssueCount: 0,
      goalStatusCounts: {
        achieved: goalAssessments.filter(
          (goal) => goal.assessmentStatus === "achieved",
        ).length,
        notAchieved: 0,
        evidenceCompiled: 0,
        qualitativeEvidenceOnly: 0,
        mixedEvidence: 0,
        requiresClarification: 0,
        requiresCapability: 0,
      },
      contextExtraction: {
        totalCategoricalColumnsSeen: 0,
        contextCandidatesProposed: 0,
        contextCandidatesExcludedByReferencedStrings: 0,
        contextCandidatesExcludedByMissingEpistemicRole: 0,
        contextCandidatesMaterialized: 0,
        preparedTableFallbackTableCount: 0,
      },
    },
    validation: { status: "passed", issues: [] },
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function buildUpload(id: string, activityId: string) {
  return { id, activityId };
}
