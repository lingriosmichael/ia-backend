import type { ActivityAnalysisV2GoalAssessmentStatus } from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";

// A goal assessment at these statuses has nothing grounded to show yet —
// its supporting calculations (if any) describe an unresolved question, not
// a real project result, so calculations reachable only through these
// statuses are excluded from every display surface (tiles, catalog
// calculation entries). The goal assessment record itself is still real
// data (e.g. "this goal is stuck on a missing capability" is a true fact
// worth surfacing as a gap) — this gate is about calculation *values*, not
// about hiding the assessment record, see projectImpactStoryCatalog.ts.
export const UNGROUNDED_GOAL_ASSESSMENT_STATUSES =
  new Set<ActivityAnalysisV2GoalAssessmentStatus>([
    "requires_clarification",
    "requires_capability",
  ]);

export function collectGroundedCalculationIds(
  run: ActivityAnalysisRunV2PersistenceRecord,
): Set<string> {
  const groundedCalculationIds = new Set<string>();
  for (const goalAssessment of run.assessment?.goalAssessments ?? []) {
    if (
      UNGROUNDED_GOAL_ASSESSMENT_STATUSES.has(goalAssessment.assessmentStatus)
    ) {
      continue;
    }
    for (const calculationId of goalAssessment.supportingCalculationIds) {
      groundedCalculationIds.add(calculationId);
    }
  }
  return groundedCalculationIds;
}
