import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityAssessmentV2 } from "./activityAnalysisV2Assessment.js";
import { buildEpistemicRoleGateDowngradeMessage } from "./activityAnalysisV2EpistemicRoleGate.js";
import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2QualitativeFindingRecord,
} from "../../shared/contracts.js";
import type {
  ActivityAnalysisV2GoalPlan,
  ActivityAnalysisV2PlanToolRequest,
} from "../processing/pythonProcessingClient.js";
import type { ActivityAnalysisV2ToolCallRecord } from "../../shared/contracts.js";

function buildGoal(
  overrides?: Partial<ActivityAnalysisV2GoalPlan>,
): ActivityAnalysisV2GoalPlan {
  return {
    goalId: "output_1",
    goalType: "output",
    goalText: "65 geeignete Mentor:innen auswählen",
    evaluationMode: "numeric_target",
    status: "planned",
    rationale: "Count suitable mentors and compare against the target.",
    plannedToolNames: ["count_distinct", "compare_target"],
    ...overrides,
  };
}

function buildCompareTargetCalculation(
  calculationId: string,
  overrides?: Partial<ActivityAnalysisV2CalculationRecord>,
): ActivityAnalysisV2CalculationRecord {
  return {
    calculationId,
    toolName: "compare_target",
    label: "Target comparison",
    description: "Compares the measured value against the goal target.",
    formula: "value at_least target",
    value: true,
    unit: null,
    sourceUploadMetadataIds: ["upload-1"],
    sourceTableNames: ["bewerbungen"],
    sourceColumns: [],
    result: {
      achieved: true,
      comparison: "at_least",
      value: 70,
      target: 65,
    },
    ...overrides,
  };
}

function buildToolRequest(
  overrides?: Partial<ActivityAnalysisV2PlanToolRequest>,
): ActivityAnalysisV2PlanToolRequest {
  return {
    goalId: "output_1",
    alias: null,
    toolName: "compare_target",
    ...overrides,
  } as ActivityAnalysisV2PlanToolRequest;
}

function buildToolCallTraceEntry(
  calculationIds: string[],
): ActivityAnalysisV2ToolCallRecord {
  return {
    toolCallId: "tool-1",
    toolName: "compare_target",
    arguments: {},
    calculationIds,
    status: "succeeded",
    errorMessage: null,
    startedAt: "2026-08-08T10:00:00.000Z",
    completedAt: "2026-08-08T10:00:00.010Z",
    durationMs: 10,
  };
}

function buildQualitativeFinding(
  findingId: string,
  overrides?: Partial<ActivityAnalysisV2QualitativeFindingRecord>,
): ActivityAnalysisV2QualitativeFindingRecord {
  return {
    findingId,
    toolName: "excerpt_retrieval",
    label: "Mentor reflection excerpts",
    description: "Grounded excerpts from mentor reflections.",
    themeOrCode: "theme_code=improved",
    excerpts: [
      {
        sourceRowId: "P1",
        verbatimText: "I feel more confident speaking in the group now.",
        sourceColumn: "reflection_note",
      },
    ],
    totalMatchingRows: 3,
    excerptsReturned: 1,
    frequency: {
      count: 3,
      denominator: 3,
      denominatorType: "rows",
    },
    codingMethod: "source_provided",
    reliabilitySignal: {
      missingValuePct: 0,
      raterCount: "unknown",
    },
    sourceUploadMetadataIds: ["upload-1"],
    sourceTableNames: ["feedback"],
    sourceColumns: ["reflection_note"],
    sourceColumnEpistemicRoles: [
      { columnName: "reflection_note", epistemicRole: "free_text" },
    ],
    identifierColumn: "participant_id",
    ...overrides,
  };
}

test("a single compare_target result produces a grounded achieved/not_achieved verdict", () => {
  const calculation = buildCompareTargetCalculation("calc-1");
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [buildToolRequest()],
    toolCallTrace: [buildToolCallTraceEntry(["calc-1"])],
    calculations: [calculation],
    qualitativeFindings: [],
    limitations: [],
  });

  assert.equal(result.assessment.goalAssessments.length, 1);
  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "achieved");
  assert.equal(goalAssessment.measuredValue, 70);
  assert.equal(goalAssessment.targetValue, 65);
  assert.equal(result.validation.status, "passed");
});

test("two compare_target results for the same goal fail validation instead of silently using only the first", () => {
  const first = buildCompareTargetCalculation("calc-1", {
    result: { achieved: true, comparison: "at_least", value: 70, target: 65 },
  });
  const second = buildCompareTargetCalculation("calc-2", {
    result: { achieved: false, comparison: "at_least", value: 40, target: 65 },
  });
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [
      buildToolRequest({ alias: "first" }),
      buildToolRequest({ alias: "second" }),
    ],
    toolCallTrace: [
      buildToolCallTraceEntry(["calc-1"]),
      buildToolCallTraceEntry(["calc-2"]),
    ],
    calculations: [first, second],
    qualitativeFindings: [],
    limitations: [],
  });

  assert.equal(result.assessment.goalAssessments.length, 1);
  const goalAssessment = result.assessment.goalAssessments[0]!;
  // Neither compare_target result is silently picked as "the" answer.
  assert.notEqual(goalAssessment.assessmentStatus, "achieved");
  assert.notEqual(goalAssessment.assessmentStatus, "not_achieved");
  assert.equal(goalAssessment.achieved, null);
  assert.equal(result.validation.status, "failed");
  assert.ok(
    result.validation.issues.some((issue) =>
      issue.includes("expected at most one"),
    ),
    `expected a duplicate-target-comparison issue, got: ${JSON.stringify(result.validation.issues)}`,
  );
});

test("an epistemic-role gate downgrade becomes qualitative_evidence_only instead of a failed assessment", () => {
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [buildToolRequest()],
    toolCallTrace: [
      {
        toolCallId: "tool-1",
        toolName: "compare_target",
        arguments: {},
        calculationIds: [],
        status: "failed",
        errorMessage: buildEpistemicRoleGateDowngradeMessage({
          toolName: "compare_target",
          role: "subjective_code",
          columnName: "sentiment",
        }),
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
    ],
    calculations: [],
    qualitativeFindings: [],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "qualitative_evidence_only");
  assert.equal(goalAssessment.evidenceTensionFlag, false);
  assert.equal(goalAssessment.measuredValue, null);
  assert.equal(result.validation.status, "passed");
});

test("a goal becomes mixed_evidence when a target comparison and qualitative-coded support both exist", () => {
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [
      buildToolRequest({ toolName: "group_count" }),
      buildToolRequest(),
    ],
    toolCallTrace: [
      {
        toolCallId: "tool-qual",
        toolName: "group_count",
        arguments: {},
        calculationIds: ["calc-qual"],
        status: "succeeded",
        errorMessage: null,
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
      buildToolCallTraceEntry(["calc-1"]),
    ],
    calculations: [
      {
        calculationId: "calc-qual",
        toolName: "group_count",
        label: "Theme counts",
        description: "Counts coded reflection themes.",
        formula: null,
        value: 2,
        unit: "groups",
        sourceUploadMetadataIds: ["upload-1"],
        sourceTableNames: ["feedback"],
        sourceColumns: ["theme_code"],
        sourceColumnEpistemicRoles: [
          { columnName: "theme_code", epistemicRole: "subjective_code" },
        ],
        result: {
          groups: [
            { value: "improved", count: 7 },
            { value: "stalled", count: 3 },
          ],
        },
      },
      buildCompareTargetCalculation("calc-1"),
    ],
    qualitativeFindings: [],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "mixed_evidence");
  assert.equal(goalAssessment.evidenceTensionFlag, false);
  assert.equal(goalAssessment.measuredValue, 70);
  assert.equal(result.validation.status, "passed");
});

test("mixed evidence raises evidenceTensionFlag when the epistemic-role gate also blocks an outcome claim", () => {
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [
      buildToolRequest({ toolName: "group_count" }),
      buildToolRequest(),
      buildToolRequest({ toolName: "aggregate_numeric" }),
    ],
    toolCallTrace: [
      {
        toolCallId: "tool-qual",
        toolName: "group_count",
        arguments: {},
        calculationIds: ["calc-qual"],
        status: "succeeded",
        errorMessage: null,
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
      buildToolCallTraceEntry(["calc-1"]),
      {
        toolCallId: "tool-gate",
        toolName: "aggregate_numeric",
        arguments: {},
        calculationIds: [],
        status: "failed",
        errorMessage: buildEpistemicRoleGateDowngradeMessage({
          toolName: "aggregate_numeric",
          role: "subjective_code",
          columnName: "theme_code",
        }),
        startedAt: "2026-08-08T10:00:00.020Z",
        completedAt: "2026-08-08T10:00:00.030Z",
        durationMs: 10,
      },
    ],
    calculations: [
      {
        calculationId: "calc-qual",
        toolName: "group_count",
        label: "Theme counts",
        description: "Counts coded reflection themes.",
        formula: null,
        value: 2,
        unit: "groups",
        sourceUploadMetadataIds: ["upload-1"],
        sourceTableNames: ["feedback"],
        sourceColumns: ["theme_code"],
        sourceColumnEpistemicRoles: [
          { columnName: "theme_code", epistemicRole: "subjective_code" },
        ],
        result: {
          groups: [
            { value: "improved", count: 7 },
            { value: "stalled", count: 3 },
          ],
        },
      },
      buildCompareTargetCalculation("calc-1"),
    ],
    qualitativeFindings: [],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "mixed_evidence");
  assert.equal(goalAssessment.evidenceTensionFlag, true);
  assert.match(goalAssessment.findingText, /epistemic-role guardrail/i);
  assert.equal(result.validation.status, "passed");
});

test("evidenceTensionFlag fires from a rate divergence even when no epistemic-role gate ever rejected a request", () => {
  // This is the plan's canonical tension scenario: a legitimate compare_target
  // (survey self-efficacy score) and a legitimate, independently executed
  // qualitative finding (coded reflection notes) for the same goal, where
  // nothing was ever blocked by the gate — the two sources just disagree.
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [
      buildToolRequest({ toolName: "group_count" }),
      buildToolRequest(),
    ],
    toolCallTrace: [
      {
        toolCallId: "tool-qual",
        toolName: "group_count",
        arguments: {},
        calculationIds: ["calc-qual"],
        qualitativeFindingIds: ["finding-1"],
        status: "succeeded",
        errorMessage: null,
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
      buildToolCallTraceEntry(["calc-1"]),
    ],
    calculations: [
      {
        calculationId: "calc-qual",
        toolName: "group_count",
        label: "Self-efficacy score coverage",
        description: "Rate of rows with a positive self-efficacy score.",
        formula: null,
        value: 70,
        unit: "rows",
        sourceUploadMetadataIds: ["upload-1"],
        sourceTableNames: ["feedback"],
        sourceColumns: ["self_efficacy_score"],
        numerator: 70,
        denominator: 100,
        denominatorType: "rows",
        result: { basis: "analysis_rows" },
      },
      buildCompareTargetCalculation("calc-1"),
    ],
    qualitativeFindings: [
      buildQualitativeFinding("finding-1", {
        frequency: { count: 10, denominator: 100, denominatorType: "rows" },
      }),
    ],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "mixed_evidence");
  assert.equal(goalAssessment.evidenceTensionFlag, true);
  assert.equal(result.validation.status, "passed");
});

test("evidenceTensionFlag stays false when a qualitative finding's rate is not on the same denominator basis", () => {
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [
      buildToolRequest({ toolName: "group_count" }),
      buildToolRequest(),
    ],
    toolCallTrace: [
      {
        toolCallId: "tool-qual",
        toolName: "group_count",
        arguments: {},
        calculationIds: ["calc-qual"],
        qualitativeFindingIds: ["finding-1"],
        status: "succeeded",
        errorMessage: null,
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
      buildToolCallTraceEntry(["calc-1"]),
    ],
    calculations: [
      {
        calculationId: "calc-qual",
        toolName: "group_count",
        label: "Self-efficacy score coverage",
        description: "Rate of rows with a positive self-efficacy score.",
        formula: null,
        value: 70,
        unit: "rows",
        sourceUploadMetadataIds: ["upload-1"],
        sourceTableNames: ["feedback"],
        sourceColumns: ["self_efficacy_score"],
        numerator: 70,
        denominator: 100,
        denominatorType: "distinct_entities",
        result: { basis: "analysis_rows" },
      },
      buildCompareTargetCalculation("calc-1"),
    ],
    qualitativeFindings: [
      buildQualitativeFinding("finding-1", {
        frequency: { count: 10, denominator: 100, denominatorType: "rows" },
      }),
    ],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "mixed_evidence");
  assert.equal(goalAssessment.evidenceTensionFlag, false);
});

test("excerpt retrieval alone can ground a qualitative_evidence_only goal", () => {
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [
      buildGoal({
        evaluationMode: "evidence_only",
        plannedToolNames: ["excerpt_retrieval"],
      }),
    ],
    plannedToolRequests: [
      buildToolRequest({
        toolName: "excerpt_retrieval",
        alias: null,
      }),
    ],
    toolCallTrace: [
      {
        toolCallId: "tool-excerpt",
        toolName: "excerpt_retrieval",
        arguments: {},
        calculationIds: [],
        qualitativeFindingIds: ["finding-1"],
        status: "succeeded",
        errorMessage: null,
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:00.010Z",
        durationMs: 10,
      },
    ],
    calculations: [],
    qualitativeFindings: [buildQualitativeFinding("finding-1")],
    limitations: [],
  });

  const goalAssessment = result.assessment.goalAssessments[0]!;
  assert.equal(goalAssessment.assessmentStatus, "qualitative_evidence_only");
  assert.deepEqual(goalAssessment.supportingQualitativeFindingIds, [
    "finding-1",
  ]);
  assert.equal(result.validation.status, "passed");
});
