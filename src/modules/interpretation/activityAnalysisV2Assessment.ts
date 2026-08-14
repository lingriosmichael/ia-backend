import type {
  ActivityAssessmentV2,
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2MissingCapability,
  ActivityAnalysisV2QualitativeFindingRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisRunV2Validation,
  EpistemicRole,
} from "../../shared/contracts.js";
import type {
  ActivityAnalysisV2GoalPlan,
  ActivityAnalysisV2PlanToolRequest,
} from "../processing/pythonProcessingClient.js";
import { isEpistemicRoleGateDowngradeMessage } from "./activityAnalysisV2EpistemicRoleGate.js";

interface BuildActivityAssessmentV2Input {
  language: "de" | "en";
  goals: ActivityAnalysisV2GoalPlan[];
  plannedToolRequests: ActivityAnalysisV2PlanToolRequest[];
  toolCallTrace: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
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

const QUALITATIVE_SIGNAL_EPISTEMIC_ROLES = new Set<EpistemicRole>([
  "subjective_code",
  "free_text",
]);

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

function calculationUsesQualitativeSignal(
  calculation: ActivityAnalysisV2CalculationRecord,
): boolean {
  return (calculation.sourceColumnEpistemicRoles ?? []).some(
    (entry) =>
      entry.epistemicRole !== null &&
      QUALITATIVE_SIGNAL_EPISTEMIC_ROLES.has(entry.epistemicRole),
  );
}

function calculationUsesNonQualitativeSignal(
  calculation: ActivityAnalysisV2CalculationRecord,
): boolean {
  const epistemicRoles = (calculation.sourceColumnEpistemicRoles ?? []).flatMap(
    (entry) => (entry.epistemicRole ? [entry.epistemicRole] : []),
  );
  if (epistemicRoles.length === 0) {
    return true;
  }
  return epistemicRoles.some(
    (role) => !QUALITATIVE_SIGNAL_EPISTEMIC_ROLES.has(role),
  );
}

const EVIDENCE_TENSION_RATE_DIVERGENCE_THRESHOLD_POINTS = 15;

// Finds the calculation that actually produced compare_target's measured value
// (as opposed to compare_target's own calculation record, whose numerator/
// denominator/denominatorType are placeholders describing value-vs-target, not
// what was counted). Only that source calculation carries a real
// numerator/denominator pair on a known denominator basis.
function findComparableRateCalculation(
  calculations: ActivityAnalysisV2CalculationRecord[],
  measuredValue: number,
): ActivityAnalysisV2CalculationRecord | null {
  return (
    calculations.find(
      (calculation) =>
        calculation.toolName !== "compare_target" &&
        calculation.value === measuredValue &&
        calculation.numerator != null &&
        calculation.denominator != null &&
        calculation.denominator > 0 &&
        calculation.denominatorType != null,
    ) ?? null
  );
}

// A qualitative finding's frequency and a quantitative calculation's
// numerator/denominator are only safely comparable when they count the same
// kind of denominator (e.g. both "rows" or both "distinct_entities") — the
// schema has no shared percentage/unit marker, so comparing compare_target's
// `value`/`target` directly against a qualitative rate would be guessing at
// units. This only fires on the narrow case where both sides are provably on
// the same 0-100 scale, and is deliberately a coarse divergence signal, not a
// semantic-direction judgment (excerpt-only findings with no frequency data
// can't be checked this way at all, and stay flagged false).
function qualitativeFindingsDivergeFromRate(
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[],
  comparableCalculation: ActivityAnalysisV2CalculationRecord | null,
): boolean {
  if (
    !comparableCalculation ||
    comparableCalculation.numerator == null ||
    !comparableCalculation.denominator
  ) {
    return false;
  }
  const quantitativeRate =
    (comparableCalculation.numerator / comparableCalculation.denominator) * 100;
  return qualitativeFindings.some((finding) => {
    const frequency = finding.frequency;
    if (
      !frequency ||
      frequency.denominator === null ||
      frequency.denominator <= 0 ||
      frequency.denominatorType !== comparableCalculation.denominatorType
    ) {
      return false;
    }
    const qualitativeRate = (frequency.count / frequency.denominator) * 100;
    return (
      Math.abs(qualitativeRate - quantitativeRate) >=
      EVIDENCE_TENSION_RATE_DIVERGENCE_THRESHOLD_POINTS
    );
  });
}

function buildGoalFindingText(input: {
  language: "de" | "en";
  goalId: string;
  goalText: string;
  plannerStatus: "planned" | "requires_clarification" | "requires_capability";
  evaluationMode:
    "numeric_target" | "condition" | "directional_change" | "evidence_only";
  rationale: string;
  missingCapabilities: ActivityAnalysisV2MissingCapability[];
  toolCalls: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
}): {
  assessmentStatus:
    | "achieved"
    | "not_achieved"
    | "evidence_compiled"
    | "qualitative_evidence_only"
    | "mixed_evidence"
    | "requires_clarification"
    | "requires_capability";
  findingText: string;
  evidenceTensionFlag: boolean;
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
      evidenceTensionFlag: false,
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
      evidenceTensionFlag: false,
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
  const epistemicRoleGateDowngraded = input.toolCalls.some((toolCall) =>
    isEpistemicRoleGateDowngradeMessage(toolCall.errorMessage),
  );
  const hasQualitativeFindingSupport = input.qualitativeFindings.length > 0;
  const hasQualitativeEvidenceSignal =
    hasQualitativeFindingSupport ||
    epistemicRoleGateDowngraded ||
    input.calculations.some(calculationUsesQualitativeSignal);
  const hasNonQualitativeEvidenceSignal = input.calculations.some(
    calculationUsesNonQualitativeSignal,
  );
  const qualitativeOnly =
    !comparisonCalculations[0] &&
    (input.evaluationMode === "evidence_only" ||
      epistemicRoleGateDowngraded ||
      (hasQualitativeFindingSupport && !hasNonQualitativeEvidenceSignal));

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
      evidenceTensionFlag: false,
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
    const mixedEvidence = hasQualitativeEvidenceSignal;
    // epistemicRoleGateDowngraded means the planner itself tried to fold
    // qualitative evidence into this same numeric claim and got blocked —
    // that attempt is tension-worthy on its own. The rate-divergence check
    // covers the more common case the plan actually motivates this field
    // with: a legitimate compare_target *and* a legitimate, independently
    // executed qualitative finding for the same goal whose numbers pull in
    // different directions, with no gate rejection involved at all.
    const comparableRateCalculation = findComparableRateCalculation(
      input.calculations,
      measuredValue,
    );
    const evidenceTensionFlag =
      mixedEvidence &&
      (epistemicRoleGateDowngraded ||
        qualitativeFindingsDivergeFromRate(
          input.qualitativeFindings,
          comparableRateCalculation,
        ));
    return {
      assessmentStatus: mixedEvidence
        ? "mixed_evidence"
        : result.achieved
          ? "achieved"
          : "not_achieved",
      findingText:
        input.language === "de"
          ? mixedEvidence
            ? evidenceTensionFlag
              ? `${goalText}: Es liegt ein quantitativer Zielvergleich vor, zugleich verweist ergänzende qualitative bzw. codierte Evidenz auf zusätzliche Signalrichtungen, die wegen der epistemischen Schutzregel nicht zu demselben Outcome-Claim verdichtet wurden. Der gemessene Wert liegt bei ${formatNumber(measuredValue, "de")} gegenüber dem Ziel ${formatNumber(targetValue, "de")}.`
              : `${goalText}: Es liegen sowohl ein quantitativer Zielvergleich als auch ergänzende qualitative bzw. codierte Evidenz vor. Der gemessene Wert liegt bei ${formatNumber(measuredValue, "de")} gegenüber dem Ziel ${formatNumber(targetValue, "de")}.`
            : `${goalText}: Gemessener Wert ${formatNumber(measuredValue, "de")} bei Ziel ${formatNumber(targetValue, "de")}. Dieses Ziel ist ${result.achieved ? "erreicht" : "nicht erreicht"}.`
          : mixedEvidence
            ? evidenceTensionFlag
              ? `${goalText}: A quantitative target comparison is available, while additional qualitative or coded evidence points to extra signal directions that were not collapsed into the same outcome claim because of the epistemic-role guardrail. The measured value is ${formatNumber(measuredValue, "en")} against a target of ${formatNumber(targetValue, "en")}.`
              : `${goalText}: Both a quantitative target comparison and supporting qualitative or coded evidence are present. The measured value is ${formatNumber(measuredValue, "en")} against a target of ${formatNumber(targetValue, "en")}.`
            : `${goalText}: Measured value ${formatNumber(measuredValue, "en")} against target ${formatNumber(targetValue, "en")}. This goal is ${result.achieved ? "achieved" : "not achieved"}.`,
      evidenceTensionFlag,
      measuredValue,
      targetValue,
      comparison: result.comparison,
      achieved: result.achieved,
      issue: null,
    };
  }

  if (qualitativeOnly) {
    return {
      assessmentStatus: "qualitative_evidence_only",
      findingText:
        input.language === "de"
          ? `${goalText}: Für dieses Ziel liegt derzeit nur qualitative oder codierte Evidenz ohne direkten numerischen Zielvergleich vor. ${rationale}`.trim()
          : `${goalText}: This goal is currently grounded only by qualitative or coded evidence without a direct numeric target comparison. ${rationale}`.trim(),
      evidenceTensionFlag: false,
      measuredValue: null,
      targetValue: null,
      comparison: null,
      achieved: null,
      issue: null,
    };
  }

  return {
    assessmentStatus: "evidence_compiled",
    findingText:
      input.language === "de"
        ? `${goalText}: Für dieses Ziel wurden deterministische Evidenzprüfungen ausgeführt, aber noch kein direkter Zielvergleich abgeleitet.`
        : `${goalText}: Deterministic evidence checks were executed for this goal, but no direct target comparison was derived yet.`,
    evidenceTensionFlag: false,
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
      goalAssessment.supportingCalculationIds.length === 0 &&
      goalAssessment.assessmentStatus !== "qualitative_evidence_only"
    ) {
      issues.push(
        `Planned goal ${goalAssessment.goalId} has no supporting deterministic calculations.`,
      );
    }

    if (
      (goalAssessment.assessmentStatus === "achieved" ||
        goalAssessment.assessmentStatus === "not_achieved" ||
        goalAssessment.assessmentStatus === "mixed_evidence") &&
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
  const qualitativeFindingIdsByGoalId = new Map<string, string[]>();
  const toolCallsByGoalId = new Map<
    string,
    ActivityAnalysisV2ToolCallRecord[]
  >();
  input.plannedToolRequests.forEach((toolRequest, index) => {
    const toolCall = input.toolCallTrace[index];
    const calculationIds = toolCall?.calculationIds ?? [];
    const qualitativeFindingIds = toolCall?.qualitativeFindingIds ?? [];
    const existing = calculationIdsByGoalId.get(toolRequest.goalId) ?? [];
    calculationIdsByGoalId.set(toolRequest.goalId, [
      ...existing,
      ...calculationIds,
    ]);
    qualitativeFindingIdsByGoalId.set(toolRequest.goalId, [
      ...(qualitativeFindingIdsByGoalId.get(toolRequest.goalId) ?? []),
      ...qualitativeFindingIds,
    ]);
    if (toolCall) {
      toolCallsByGoalId.set(toolRequest.goalId, [
        ...(toolCallsByGoalId.get(toolRequest.goalId) ?? []),
        toolCall,
      ]);
    }
  });

  const assessment: ActivityAssessmentV2 = {
    goalAssessments: input.goals.map((goal) => {
      const supportingCalculationIds = Array.from(
        new Set(calculationIdsByGoalId.get(goal.goalId) ?? []),
      );
      const supportingQualitativeFindingIds = Array.from(
        new Set(qualitativeFindingIdsByGoalId.get(goal.goalId) ?? []),
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
      const qualitativeFindingsById = new Map(
        input.qualitativeFindings.map((finding) => [
          finding.findingId,
          finding,
        ]),
      );
      const supportingQualitativeFindings =
        supportingQualitativeFindingIds.flatMap((findingId) => {
          const finding = qualitativeFindingsById.get(findingId);
          if (!finding) {
            issues.push(
              `Tool execution referenced unknown qualitative finding ${findingId} for goal ${goal.goalId}.`,
            );
            return [];
          }
          return [finding];
        });
      const finding = buildGoalFindingText({
        language: input.language,
        goalId: goal.goalId,
        goalText: goal.goalText,
        plannerStatus: goal.status,
        evaluationMode: goal.evaluationMode,
        rationale: goal.rationale,
        missingCapabilities: goal.missingCapabilities ?? [],
        toolCalls: toolCallsByGoalId.get(goal.goalId) ?? [],
        calculations: supportingCalculations,
        qualitativeFindings: supportingQualitativeFindings,
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
        supportingQualitativeFindingIds,
        evidenceTensionFlag: finding.evidenceTensionFlag,
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
