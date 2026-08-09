import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityAssessmentV2 } from "./activityAnalysisV2Assessment.js";
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import type {
  ActivityAnalysisV2GoalPlan,
  ActivityAnalysisV2PlanToolRequest,
} from "../processing/pythonProcessingClient.js";

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

test("a single compare_target result produces a grounded achieved/not_achieved verdict", () => {
  const calculation = buildCompareTargetCalculation("calc-1");
  const result = buildActivityAssessmentV2({
    language: "en",
    goals: [buildGoal()],
    plannedToolRequests: [buildToolRequest()],
    toolCallTrace: [{ calculationIds: ["calc-1"] }],
    calculations: [calculation],
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
      { calculationIds: ["calc-1"] },
      { calculationIds: ["calc-2"] },
    ],
    calculations: [first, second],
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
