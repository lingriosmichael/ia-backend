import type {
  ActivityAnalysisV2GoalAssessmentStatus,
  ImpactIndicatorTile,
} from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import { buildCalculationDisplayTile } from "./projectImpactStoryCalculationDisplay.js";
import { collectGroundedCalculationIds } from "./projectImpactStoryGrounding.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

interface ProjectImpactStoryCatalogInputActivity {
  id: string;
  name: string;
}

interface ProjectImpactStoryCatalogInputUpload {
  id: string;
  activityId: string;
}

export interface ProjectImpactStoryCatalogCalculationEntry {
  kind: "calculation";
  entryId: string;
  activityId: string;
  activityName: string;
  toolName: string;
  unit: string | null;
  denominatorType: string | null;
  // Reuses the same display shape project impact story tiles already use —
  // a catalog "calculation" entry *is* a displayable tile plus provenance,
  // never a second, drifting representation of the same fact.
  tile: ImpactIndicatorTile;
}

export interface ProjectImpactStoryCatalogGoalAssessmentEntry {
  kind: "goal_assessment";
  entryId: string;
  activityId: string;
  activityName: string;
  goalType: "output";
  goalText: string;
  assessmentStatus: ActivityAnalysisV2GoalAssessmentStatus;
  achieved: boolean | null;
}

export type ProjectImpactStoryCatalogEntry =
  | ProjectImpactStoryCatalogCalculationEntry
  | ProjectImpactStoryCatalogGoalAssessmentEntry;

function buildCalculationEntryId(
  activityId: string,
  calculationId: string,
): string {
  return `${activityId}:calc:${calculationId}`;
}

function buildGoalAssessmentEntryId(
  activityId: string,
  goalId: string,
): string {
  return `${activityId}:goal:${goalId}`;
}

// Builds the "available facts catalog" a chart-plan LLM call is allowed to
// reference by entryId. Two kinds of entry:
// - "calculation": a real, grounded, displayable V2 calculation (same
//   eligibility rule as the per-activity tiles in projectImpactStoryAssembly)
// - "goal_assessment": every goal assessment regardless of status, since the
//   status itself (including requires_clarification/requires_capability —
//   i.e. a real gap) is true data even when no reliable calculation backs it
//
// This function only decides *what facts exist*; it never decides which of
// them get featured or how they're aggregated into a KPI/chart — that
// selection is proposed by Python's chart-plan endpoint and then
// deterministically validated/executed in
// projectImpactStoryChartPlanExecution.ts.
export function buildProjectImpactStoryCatalog(
  activities: ProjectImpactStoryCatalogInputActivity[],
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[],
  uploads: ProjectImpactStoryCatalogInputUpload[],
  language: "de" | "en",
): ProjectImpactStoryCatalogEntry[] {
  const { latestRunsByActivityId } = selectCurrentV2RunsByActivity(
    activities,
    activityAnalysisRuns,
    uploads,
  );

  const entries: ProjectImpactStoryCatalogEntry[] = [];

  for (const activity of activities) {
    const run = latestRunsByActivityId.get(activity.id);
    if (!run) {
      continue;
    }

    const groundedCalculationIds = collectGroundedCalculationIds(run);
    for (const calculation of run.calculations) {
      if (!groundedCalculationIds.has(calculation.calculationId)) {
        continue;
      }
      const tile = buildCalculationDisplayTile(calculation, language);
      if (!tile) {
        continue;
      }
      entries.push({
        kind: "calculation",
        entryId: buildCalculationEntryId(
          activity.id,
          calculation.calculationId,
        ),
        activityId: activity.id,
        activityName: activity.name,
        toolName: calculation.toolName,
        unit: calculation.unit,
        denominatorType: calculation.denominatorType ?? null,
        tile,
      });
    }

    for (const goalAssessment of run.assessment?.goalAssessments ?? []) {
      entries.push({
        kind: "goal_assessment",
        entryId: buildGoalAssessmentEntryId(activity.id, goalAssessment.goalId),
        activityId: activity.id,
        activityName: activity.name,
        goalType: goalAssessment.goalType,
        goalText: goalAssessment.goalText,
        assessmentStatus: goalAssessment.assessmentStatus,
        achieved: goalAssessment.achieved,
      });
    }
  }

  return entries;
}

// Flattens the internal discriminated-union catalog (which keeps full tile
// data — buckets/points — needed for backend-side chart execution) into the
// simpler wire shape Python's chart-plan endpoint actually needs to make a
// selection: a label/description/value it can reason about, never the raw
// bucket/point breakdown.
export function toProjectImpactStoryChartPlanRequestEntries(
  catalog: ProjectImpactStoryCatalogEntry[],
): Array<{
  entryId: string;
  kind: "calculation" | "goal_assessment";
  activityId: string;
  activityName: string;
  label: string;
  description: string | null;
  toolName: string | null;
  unit: string | null;
  value: number | null;
  goalType: "output" | null;
  assessmentStatus: ActivityAnalysisV2GoalAssessmentStatus | null;
  achieved: boolean | null;
}> {
  return catalog.map((entry) => {
    if (entry.kind === "calculation") {
      return {
        entryId: entry.entryId,
        kind: "calculation" as const,
        activityId: entry.activityId,
        activityName: entry.activityName,
        label: entry.tile.label,
        description: entry.tile.description,
        toolName: entry.toolName,
        unit: entry.unit,
        value: entry.tile.kind === "kpi" ? entry.tile.value : null,
        goalType: null,
        assessmentStatus: null,
        achieved: null,
      };
    }

    return {
      entryId: entry.entryId,
      kind: "goal_assessment" as const,
      activityId: entry.activityId,
      activityName: entry.activityName,
      label: entry.goalText,
      description: null,
      toolName: null,
      unit: null,
      value: null,
      goalType: entry.goalType,
      assessmentStatus: entry.assessmentStatus,
      achieved: entry.achieved,
    };
  });
}
