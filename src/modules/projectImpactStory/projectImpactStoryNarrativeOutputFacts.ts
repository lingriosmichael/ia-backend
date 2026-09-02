import type { ImpactIndicatorTileFormat } from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import { buildCalculationDisplayTile } from "./projectImpactStoryCalculationDisplay.js";
import {
  collectGroundedCalculationIds,
  UNGROUNDED_GOAL_ASSESSMENT_STATUSES,
} from "./projectImpactStoryGrounding.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

interface ProjectImpactStoryNarrativeOutputFactsInputActivity {
  id: string;
  name: string;
}

interface ProjectImpactStoryNarrativeOutputFactsInputUpload {
  id: string;
  activityId: string;
}

export interface ProjectImpactStoryNarrativeOutputFactEntry {
  entryId: string;
  goalId: string;
  goalText: string;
  label: string;
  value: number;
  formatAs: ImpactIndicatorTileFormat;
  narrativeReason: string;
}

function buildNarrativeOutputFactEntryId(
  activityId: string,
  goalId: string,
  calculationId: string,
): string {
  return `${activityId}:output_fact:${goalId}:${calculationId}`;
}

export function buildProjectImpactStoryNarrativeOutputFacts(
  activities: ProjectImpactStoryNarrativeOutputFactsInputActivity[],
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[],
  uploads: ProjectImpactStoryNarrativeOutputFactsInputUpload[],
  language: "de" | "en",
): ProjectImpactStoryNarrativeOutputFactEntry[] {
  const { latestRunsByActivityId } = selectCurrentV2RunsByActivity(
    activities,
    activityAnalysisRuns,
    uploads,
  );

  const entries: ProjectImpactStoryNarrativeOutputFactEntry[] = [];

  for (const activity of activities) {
    const run = latestRunsByActivityId.get(activity.id);
    if (!run) {
      continue;
    }

    const groundedCalculationIds = collectGroundedCalculationIds(run);
    const calculationsById = new Map(
      run.calculations.map((calculation) => [
        calculation.calculationId,
        calculation,
      ]),
    );

    for (const goalAssessment of run.assessment?.goalAssessments ?? []) {
      if (goalAssessment.goalType !== "output") {
        continue;
      }
      if (
        UNGROUNDED_GOAL_ASSESSMENT_STATUSES.has(goalAssessment.assessmentStatus)
      ) {
        continue;
      }

      for (const calculationId of goalAssessment.supportingCalculationIds) {
        if (!groundedCalculationIds.has(calculationId)) {
          continue;
        }

        const calculation = calculationsById.get(calculationId);
        if (!calculation) {
          continue;
        }

        const tile = buildCalculationDisplayTile(calculation, language);
        if (!tile || tile.kind !== "kpi" || tile.value === null) {
          continue;
        }

        entries.push({
          entryId: buildNarrativeOutputFactEntryId(
            activity.id,
            goalAssessment.goalId,
            calculationId,
          ),
          goalId: goalAssessment.goalId,
          goalText: goalAssessment.goalText,
          label: tile.label,
          value: tile.value,
          formatAs: tile.formatAs,
          narrativeReason: tile.description ?? calculation.description,
        });
      }
    }
  }

  return entries;
}
