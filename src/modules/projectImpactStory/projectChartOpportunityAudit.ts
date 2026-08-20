import type {
  ActivityAnalysisV2GoalAssessmentStatus,
  ProjectChartOpportunityAuditEntry,
  ProjectChartOpportunityStatus,
} from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import {
  buildCalculationEntryId,
  buildGoalAssessmentEntryId,
} from "./projectImpactStoryCatalog.js";
import { buildCalculationDisplayTile } from "./projectImpactStoryCalculationDisplay.js";
import { collectGroundedCalculationIds } from "./projectImpactStoryGrounding.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

export type { ProjectChartOpportunityAuditEntry } from "../../shared/contracts.js";

interface ProjectChartOpportunityAuditInputActivity {
  id: string;
  name: string;
}

interface ProjectChartOpportunityAuditInputUpload {
  id: string;
  activityId: string;
}

function parseContextSourceTables(sourceDe: string): string[] {
  const tableName = sourceDe.replace(/^Quelle:\s*/, "").trim();
  return tableName.length > 0 ? [tableName] : [];
}

function goalAssessmentOpportunityStatus(
  assessmentStatus: ActivityAnalysisV2GoalAssessmentStatus,
): { status: ProjectChartOpportunityStatus; reasonCode: string } {
  switch (assessmentStatus) {
    case "achieved":
    case "not_achieved":
    case "evidence_compiled":
    case "mixed_evidence":
      return { status: "ready_now", reasonCode: assessmentStatus };
    case "requires_capability":
      // A deterministic tool the plan needed doesn't exist yet — a
      // pipeline limitation, not missing evidence.
      return { status: "blocked_by_extraction", reasonCode: assessmentStatus };
    case "qualitative_evidence_only":
    case "requires_clarification":
    default:
      // Evidence exists but isn't measurable yet, or a human still needs
      // to answer a clarification question — both read as "the data isn't
      // there (yet)" from this audit's chart-opportunity point of view.
      return {
        status: "blocked_by_missing_data",
        reasonCode: assessmentStatus,
      };
  }
}

// Deterministic (no LLM) audit of every chart-worthy fact a project's
// current V2 runs could support, classified into whether it's already
// materialized, blocked by a pipeline gap, or blocked by missing/
// insufficient evidence. Mirrors buildProjectImpactStoryCatalog's own
// activity/run selection and entryId scheme exactly (reusing its exported
// id builders) so this audit's entryIds line up 1:1 with the real
// chart-plan catalog — required for projectChartSelectionAudit.ts's diff
// against what the planner actually selected.
//
// "blocked_by_extraction" for context_distribution is currently reported
// per-activity, not per-column: activityAnalysisRunV2Persistence only
// persists aggregate contextExtraction counts (see
// activityAnalysisV2Diagnostics.ts), not which specific column each count
// refers to. Naming the exact blocked column would require re-deriving
// live evidence tables outside the V2 run pipeline — a larger, separate
// piece of work, not something to half-build here.
export function buildProjectChartOpportunityAudit(
  activities: ProjectChartOpportunityAuditInputActivity[],
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[],
  uploads: ProjectChartOpportunityAuditInputUpload[],
): ProjectChartOpportunityAuditEntry[] {
  const { latestRunsByActivityId, activitiesExcludedIds } =
    selectCurrentV2RunsByActivity(activities, activityAnalysisRuns, uploads);
  const activitiesExcludedIdSet = new Set(activitiesExcludedIds);
  const activityById = new Map(
    activities.map((activity) => [activity.id, activity]),
  );

  const entries: ProjectChartOpportunityAuditEntry[] = [];

  for (const activityId of activitiesExcludedIdSet) {
    const activity = activityById.get(activityId);
    if (!activity) {
      continue;
    }
    const hasAnyUpload = uploads.some(
      (upload) => upload.activityId === activityId,
    );
    entries.push({
      entryId: `${activityId}:opportunity:no_current_run`,
      kind: "calculation",
      activityId,
      activityName: activity.name,
      title: `${activity.name}: no current analysis run`,
      sourceTables: [],
      status: "blocked_by_missing_data",
      reasonCode: hasAnyUpload
        ? "stale_or_missing_analysis_run"
        : "no_evidence_uploaded",
      reasonDetail: hasAnyUpload
        ? "This activity has evidence, but no completed ActivityAnalystV2 run matches its current uploads — run analysis again to enable chart candidates."
        : "This activity has no uploaded evidence yet.",
    });
  }

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
      const tile = buildCalculationDisplayTile(calculation, "de");
      if (!tile) {
        continue;
      }
      entries.push({
        entryId: buildCalculationEntryId(
          activity.id,
          calculation.calculationId,
        ),
        kind: "calculation",
        activityId: activity.id,
        activityName: activity.name,
        title: tile.label,
        sourceTables: [...calculation.sourceTableNames],
        status: "ready_now",
        reasonCode: "grounded_calculation",
        reasonDetail: "Already materialized as a grounded calculation.",
      });
    }

    for (const goalAssessment of run.assessment?.goalAssessments ?? []) {
      const { status, reasonCode } = goalAssessmentOpportunityStatus(
        goalAssessment.assessmentStatus,
      );
      entries.push({
        entryId: buildGoalAssessmentEntryId(activity.id, goalAssessment.goalId),
        kind: "goal_assessment",
        activityId: activity.id,
        activityName: activity.name,
        title: goalAssessment.goalText,
        sourceTables: [],
        status,
        reasonCode,
        reasonDetail: `Goal assessment status: ${goalAssessment.assessmentStatus}.`,
      });
    }

    for (const contextEntry of run.contextCatalogEntries) {
      entries.push({
        entryId: contextEntry.entryId,
        kind: "context_distribution",
        activityId: activity.id,
        activityName: activity.name,
        title: contextEntry.labelDe,
        sourceTables: parseContextSourceTables(contextEntry.sourceDe),
        status: "ready_now",
        reasonCode: "materialized_context_distribution",
        reasonDetail: `Already materialized (n=${contextEntry.n}).`,
      });
    }

    const contextExtraction = run.diagnostics.contextExtraction;
    if (contextExtraction.contextCandidatesExcludedByMissingEpistemicRole > 0) {
      entries.push({
        entryId: `${activity.id}:opportunity:missing_epistemic_role`,
        kind: "context_distribution",
        activityId: activity.id,
        activityName: activity.name,
        title: `${activity.name}: ${contextExtraction.contextCandidatesExcludedByMissingEpistemicRole} uncategorized column(s)`,
        sourceTables: [],
        status: "blocked_by_extraction",
        reasonCode: "missing_epistemic_role",
        reasonDetail:
          `${contextExtraction.contextCandidatesExcludedByMissingEpistemicRole} evidence column(s) never resolved an epistemicRole ` +
          `(${contextExtraction.preparedTableFallbackTableCount} table(s) had no matching prepared table), so they could not be considered for a descriptive chart regardless of what they contain.`,
      });
    }
  }

  return entries;
}
