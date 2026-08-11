import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2MissingCapability,
  ActivityAnalysisRunV2Validation,
} from "../../shared/contracts.js";
import type {
  ActivityAnalysisV2GoalPlan,
  ActivityAnalysisV2PlanToolRequest,
} from "../processing/pythonProcessingClient.js";

interface BuildActivityAssessmentV2Input {
  language: "de" | "en";
  goals: ActivityAnalysisV2GoalPlan[];
  plannedToolRequests: ActivityAnalysisV2PlanToolRequest[];
  toolCallTrace: Array<{
    calculationIds: string[];
  }>;
  calculations: ActivityAnalysisV2CalculationRecord[];
  limitations: string[];
}

interface BuildActivityAssessmentV2Result {
  assessment: ActivityAssessmentV2;
  validation: ActivityAnalysisRunV2Validation;
  renderedSummary: string | null;
}

interface TargetComparisonResult {
  achieved: boolean;
  comparison: "at_least" | "at_most" | "equal";
  value: number;
  target: number;
}

function stripTemplatePlaceholders(text: string): string {
  return text
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number, language: "de" | "en"): string {
  return new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function isTargetComparisonResult(
  result: unknown,
): result is TargetComparisonResult {
  if (!result || typeof result !== "object") {
    return false;
  }
  const candidate = result as Record<string, unknown>;
  return (
    typeof candidate.achieved === "boolean" &&
    (candidate.comparison === "at_least" ||
      candidate.comparison === "at_most" ||
      candidate.comparison === "equal") &&
    typeof candidate.value === "number" &&
    typeof candidate.target === "number"
  );
}

function renderMissingCapabilitiesText(
  missingCapabilities: ActivityAnalysisV2MissingCapability[],
  language: "de" | "en",
): string {
  const details = missingCapabilities
    .map((capability) => {
      const name = stripTemplatePlaceholders(capability.name);
      const reason = stripTemplatePlaceholders(capability.reason);
      return reason ? `${name} (${reason})` : name;
    })
    .join("; ");
  return language === "de"
    ? `Es fehlt derzeit die deterministische Berechnungsfähigkeit: ${details}.`
    : `The required deterministic calculation capability is currently missing: ${details}.`;
}

function buildGoalFindingText(input: {
  language: "de" | "en";
  goalId: string;
  goalText: string;
  plannerStatus: "planned" | "requires_clarification" | "requires_capability";
  rationale: string;
  missingCapabilities: ActivityAnalysisV2MissingCapability[];
  calculations: ActivityAnalysisV2CalculationRecord[];
}): {
  assessmentStatus:
    | "achieved"
    | "not_achieved"
    | "evidence_compiled"
    | "requires_clarification"
    | "requires_capability";
  findingText: string;
  measuredValue: number | null;
  targetValue: number | null;
  comparison: "at_least" | "at_most" | "equal" | null;
  achieved: boolean | null;
  issue: string | null;
} {
  const goalText = stripTemplatePlaceholders(input.goalText);
  const rationale = stripTemplatePlaceholders(input.rationale);

  if (input.plannerStatus === "requires_clarification") {
    return {
      assessmentStatus: "requires_clarification",
      findingText:
        input.language === "de"
          ? `${goalText}: Für dieses Ziel ist noch keine belastbare deterministische Bewertung möglich. ${rationale}`.trim()
          : `${goalText}: A reliable deterministic assessment is not available yet for this goal. ${rationale}`.trim(),
      measuredValue: null,
      targetValue: null,
      comparison: null,
      achieved: null,
      issue: null,
    };
  }

  if (input.plannerStatus === "requires_capability") {
    const missingCapabilitiesText = renderMissingCapabilitiesText(
      input.missingCapabilities,
      input.language,
    );
    return {
      assessmentStatus: "requires_capability",
      findingText:
        input.language === "de"
          ? `${goalText}: Dieses Ziel kann derzeit nicht belastbar bewertet werden. ${missingCapabilitiesText} ${rationale}`.trim()
          : `${goalText}: This goal cannot be reliably assessed yet. ${missingCapabilitiesText} ${rationale}`.trim(),
      measuredValue: null,
      targetValue: null,
      comparison: null,
      achieved: null,
      issue: null,
    };
  }

  // Matched by toolName, not by result shape: a future tool that happens to
  // return the same {achieved, comparison, value, target} fields must never
  // be mistaken for a target comparison.
  const comparisonCalculations = input.calculations.filter(
    (calculation) =>
      calculation.toolName === "compare_target" &&
      isTargetComparisonResult(calculation.result),
  );

  if (comparisonCalculations.length > 1) {
    // A goal has exactly one real target (see the Python-side grounding
    // check that rejects a compare_target whose target doesn't match the
    // goal's targetNumber). Two or more target comparisons for the same
    // goal is a planning anomaly, not a case where it's safe to silently
    // keep the first and drop the rest — fail loudly instead.
    return {
      assessmentStatus: "evidence_compiled",
      findingText:
        input.language === "de"
          ? `${goalText}: Für dieses Ziel wurden mehrere widersprüchliche Zielvergleiche berechnet. Es kann keine eindeutige Bewertung abgeleitet werden.`
          : `${goalText}: Multiple conflicting target comparisons were computed for this goal. No single grounded verdict can be derived.`,
      measuredValue: null,
      targetValue: null,
      comparison: null,
      achieved: null,
      issue: `Goal ${input.goalId} produced ${comparisonCalculations.length} compare_target results; expected at most one.`,
    };
  }

  const comparisonCalculation = comparisonCalculations[0];
  if (
    comparisonCalculation &&
    isTargetComparisonResult(comparisonCalculation.result)
  ) {
    const result = comparisonCalculation.result;
    const measuredValue = result.value;
    const targetValue = result.target;
    return {
      assessmentStatus: result.achieved ? "achieved" : "not_achieved",
      findingText:
        input.language === "de"
          ? `${goalText}: Gemessener Wert ${formatNumber(measuredValue, "de")} bei Ziel ${formatNumber(targetValue, "de")}. Dieses Ziel ist ${result.achieved ? "erreicht" : "nicht erreicht"}.`
          : `${goalText}: Measured value ${formatNumber(measuredValue, "en")} against target ${formatNumber(targetValue, "en")}. This goal is ${result.achieved ? "achieved" : "not achieved"}.`,
      measuredValue,
      targetValue,
      comparison: result.comparison,
      achieved: result.achieved,
      issue: null,
    };
  }

  return {
    assessmentStatus: "evidence_compiled",
    findingText:
      input.language === "de"
        ? `${goalText}: Für dieses Ziel wurden deterministische Evidenzprüfungen ausgeführt, aber noch kein direkter Zielvergleich abgeleitet.`
        : `${goalText}: Deterministic evidence checks were executed for this goal, but no direct target comparison was derived yet.`,
    measuredValue: null,
    targetValue: null,
    comparison: null,
    achieved: null,
    issue: null,
  };
}

function validateActivityAssessmentV2(
  assessment: ActivityAssessmentV2,
): ActivityAnalysisRunV2Validation {
  const issues: string[] = [];
  const goalIds = new Set<string>();

  for (const goalAssessment of assessment.goalAssessments) {
    if (goalIds.has(goalAssessment.goalId)) {
      issues.push(
        `Duplicate goal assessment detected for ${goalAssessment.goalId}.`,
      );
    }
    goalIds.add(goalAssessment.goalId);

    if (
      goalAssessment.plannerStatus === "planned" &&
      goalAssessment.supportingCalculationIds.length === 0
    ) {
      issues.push(
        `Planned goal ${goalAssessment.goalId} has no supporting deterministic calculations.`,
      );
    }

    if (
      (goalAssessment.assessmentStatus === "achieved" ||
        goalAssessment.assessmentStatus === "not_achieved") &&
      (goalAssessment.measuredValue === null ||
        goalAssessment.targetValue === null ||
        goalAssessment.comparison === null ||
        goalAssessment.achieved === null)
    ) {
      issues.push(
        `Goal ${goalAssessment.goalId} has an incomplete target comparison assessment.`,
      );
    }
  }

  return {
    status: issues.length > 0 ? "failed" : "passed",
    issues,
  };
}

export function buildActivityAssessmentV2(
  input: BuildActivityAssessmentV2Input,
): BuildActivityAssessmentV2Result {
  const calculationById = new Map(
    input.calculations.map((calculation) => [
      calculation.calculationId,
      calculation,
    ]),
  );
  const issues: string[] = [];

  if (input.plannedToolRequests.length !== input.toolCallTrace.length) {
    issues.push(
      `Planned ${input.plannedToolRequests.length} tool requests but executed ${input.toolCallTrace.length} tool calls.`,
    );
  }

  const calculationIdsByGoalId = new Map<string, string[]>();
  input.plannedToolRequests.forEach((toolRequest, index) => {
    const toolCall = input.toolCallTrace[index];
    const calculationIds = toolCall?.calculationIds ?? [];
    const existing = calculationIdsByGoalId.get(toolRequest.goalId) ?? [];
    calculationIdsByGoalId.set(toolRequest.goalId, [
      ...existing,
      ...calculationIds,
    ]);
  });

  const assessment: ActivityAssessmentV2 = {
    goalAssessments: input.goals.map((goal) => {
      const supportingCalculationIds = Array.from(
        new Set(calculationIdsByGoalId.get(goal.goalId) ?? []),
      );
      const supportingCalculations = supportingCalculationIds.flatMap(
        (calculationId) => {
          const calculation = calculationById.get(calculationId);
          if (!calculation) {
            issues.push(
              `Tool execution referenced unknown calculation ${calculationId} for goal ${goal.goalId}.`,
            );
            return [];
          }
          return [calculation];
        },
      );
      const finding = buildGoalFindingText({
        language: input.language,
        goalId: goal.goalId,
        goalText: goal.goalText,
        plannerStatus: goal.status,
        rationale: goal.rationale,
        missingCapabilities: goal.missingCapabilities ?? [],
        calculations: supportingCalculations,
      });
      if (finding.issue) {
        issues.push(finding.issue);
      }
      return {
        goalId: goal.goalId,
        goalType: goal.goalType,
        goalText: stripTemplatePlaceholders(goal.goalText),
        evaluationMode: goal.evaluationMode,
        plannerStatus: goal.status,
        assessmentStatus: finding.assessmentStatus,
        rationale: stripTemplatePlaceholders(goal.rationale),
        findingText: finding.findingText,
        missingCapabilities: (goal.missingCapabilities ?? []).map(
          (capability) => ({
            kind: capability.kind,
            name: stripTemplatePlaceholders(capability.name),
            reason: stripTemplatePlaceholders(capability.reason),
          }),
        ),
        supportingCalculationIds,
        measuredValue: finding.measuredValue,
        targetValue: finding.targetValue,
        comparison: finding.comparison,
        achieved: finding.achieved,
      };
    }),
    limitations: input.limitations.map((limitation) =>
      stripTemplatePlaceholders(limitation),
    ),
  };

  const validation = validateActivityAssessmentV2(assessment);

  return {
    assessment,
    validation: {
      status:
        validation.status === "failed" || issues.length > 0
          ? "failed"
          : "passed",
      issues: [...issues, ...validation.issues],
    },
    renderedSummary: null,
  };
}
