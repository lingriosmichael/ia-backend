import type {
  ActivityAnalysisV2GoalAssessmentStatus,
  ContextCatalogEntry,
  ImpactIndicatorTile,
} from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import { buildCalculationDisplayTile } from "./projectImpactStoryCalculationDisplay.js";
import { collectGroundedCalculationIds } from "./projectImpactStoryGrounding.js";
import type { ProjectImpactStoryCatalogPairedStoryDeltaEntry } from "./projectImpactStoryPairedStoryDeltaCatalog.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

export type { ProjectImpactStoryCatalogPairedStoryDeltaEntry } from "./projectImpactStoryPairedStoryDeltaCatalog.js";

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
  // Carried through from the underlying ActivityAnalysisV2GoalAssessmentRecord
  // so a single goal can become its own KPI tile with a good/warn/risk
  // status (see buildKpi in projectImpactStoryChartPlanExecution.ts) —
  // recomputed by the V2 pipeline every run, never a cached verdict.
  measuredValue: number | null;
  targetValue: number | null;
  comparison: "at_least" | "at_most" | "equal" | null;
}

export interface ProjectImpactStoryCatalogContextDistributionEntry extends ContextCatalogEntry {
  kind: "context_distribution";
}

export type ProjectImpactStoryCatalogEntry =
  | ProjectImpactStoryCatalogCalculationEntry
  | ProjectImpactStoryCatalogGoalAssessmentEntry
  | ProjectImpactStoryCatalogContextDistributionEntry
  | ProjectImpactStoryCatalogPairedStoryDeltaEntry;

// Exported so other project-level readers of the same underlying V2 run
// data (e.g. projectChartOpportunityAudit.ts) can compute the identical
// entryId a given calculation/goal would get in the real catalog, without
// duplicating the id scheme and risking it drifting out of sync.
export function buildCalculationEntryId(
  activityId: string,
  calculationId: string,
): string {
  return `${activityId}:calc:${calculationId}`;
}

export function buildGoalAssessmentEntryId(
  activityId: string,
  goalId: string,
): string {
  return `${activityId}:goal:${goalId}`;
}

// Builds the "available facts catalog" a chart-plan LLM call is allowed to
// reference by entryId. Three kinds of entry:
// - "calculation": a real, grounded, displayable V2 calculation (same
//   eligibility rule as the per-activity tiles in projectImpactStoryAssembly)
// - "goal_assessment": every goal assessment regardless of status, since the
//   status itself (including requires_clarification/requires_capability —
//   i.e. a real gap) is true data even when no reliable calculation backs it
// - "context_distribution": a descriptive categorical breakdown with no
//   direct outcome-claim meaning, but still legitimate story-supporting
//   context the chart planner may choose to visualize
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
        measuredValue: goalAssessment.measuredValue,
        targetValue: goalAssessment.targetValue,
        comparison: goalAssessment.comparison,
      });
    }

    for (const contextEntry of run.contextCatalogEntries) {
      entries.push({
        kind: "context_distribution",
        ...contextEntry,
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
  kind:
    | "calculation"
    | "goal_assessment"
    | "context_distribution"
    | "paired_story_delta";
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

    if (entry.kind === "context_distribution") {
      return {
        entryId: entry.entryId,
        kind: "context_distribution" as const,
        activityId: entry.activityId,
        activityName: entry.activityName,
        label: entry.labelDe,
        description: `${entry.dimensionLabelDe}; n=${entry.n}. ${entry.sourceDe}`,
        toolName: null,
        unit: null,
        value: null,
        goalType: null,
        assessmentStatus: null,
        achieved: null,
      };
    }

    if (entry.kind === "paired_story_delta") {
      return {
        entryId: entry.entryId,
        kind: "paired_story_delta" as const,
        activityId: entry.activityId,
        activityName: entry.activityName,
        label: entry.pairLabelDe,
        // No value field — this is two numbers (before/after), not one
        // scalar the model could reason about the way a calculation's
        // single value works. n is the only number surfaced to the model.
        description: `Exploratory before/after evidence, not confirmed outcome measurement; n=${entry.nMatched} matched. ${entry.sourceDe}`,
        toolName: null,
        unit: null,
        value: null,
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
