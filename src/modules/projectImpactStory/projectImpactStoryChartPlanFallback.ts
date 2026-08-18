import type { ProjectImpactStoryHeadlineKpi } from "../../shared/contracts.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Used only when the whole Python chart-plan call throws (unavailable,
// timeout, malformed response) — distinct from and more robust than
// Python's own internal grounding-exhaustion fallback in chart_plan.py's
// _fallback_chart_plan, which still depends on the LLM call having
// succeeded at all. This fallback is built entirely from goal_assessment
// catalog entries, so it produces a meaningful result even for a project
// with no numeric calculations yet (e.g. every goal is evidence_only).
// Mirrors buildFallbackNarrativeSummary's role for the narrative call.
export function buildDeterministicFallbackChartPlan(
  catalog: ProjectImpactStoryCatalogEntry[],
): { headlineKpis: ProjectImpactStoryHeadlineKpi[] } {
  const goalAssessmentEntries = catalog.filter(
    (entry) => entry.kind === "goal_assessment",
  );

  if (goalAssessmentEntries.length === 0) {
    return { headlineKpis: [] };
  }

  const achievedGoals = goalAssessmentEntries.filter(
    (entry) => entry.assessmentStatus === "achieved",
  );
  const notAchievedGoals = goalAssessmentEntries.filter(
    (entry) => entry.assessmentStatus === "not_achieved",
  );
  const gapGoals = goalAssessmentEntries.filter(
    (entry) =>
      entry.assessmentStatus === "requires_clarification" ||
      entry.assessmentStatus === "requires_capability",
  );
  const activitiesWithAchievedOutput = new Set(
    goalAssessmentEntries
      .filter(
        (entry) =>
          entry.goalType === "output" && entry.assessmentStatus === "achieved",
      )
      .map((entry) => entry.activityId),
  );
  const evidenceCoverage =
    (goalAssessmentEntries.length - gapGoals.length) /
    goalAssessmentEntries.length;

  const headlineKpis: ProjectImpactStoryHeadlineKpi[] = [
    {
      kpiId: "fallback-goals-achieved",
      label: "Goals achieved",
      value: achievedGoals.length,
      formatAs: "number",
      narrativeReason:
        "Deterministic fallback: count of achieved goal assessments.",
    },
    {
      kpiId: "fallback-activities-with-achieved-output",
      label: "Activities with an achieved output",
      value: activitiesWithAchievedOutput.size,
      formatAs: "number",
      narrativeReason:
        "Deterministic fallback: count of activities with at least one achieved output goal.",
    },
    {
      kpiId: "fallback-goals-not-achieved",
      label: "Goals not achieved",
      value: notAchievedGoals.length,
      formatAs: "number",
      narrativeReason:
        "Deterministic fallback: count of not-achieved goal assessments.",
    },
    {
      kpiId: "fallback-evidence-coverage",
      label: "Evidence coverage",
      value: evidenceCoverage,
      formatAs: "percentage",
      narrativeReason:
        "Deterministic fallback: share of goals with grounded support (not stuck on clarification or missing capability).",
    },
  ];

  return { headlineKpis };
}
