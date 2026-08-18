import type {
  ActivityImpactStoryCard,
  ImpactIndicatorTile,
  ImpactIndicatorTileFormat,
  ProjectImpactStoryDiagnostics,
  ProjectImpactStorySourceSnapshotItem,
} from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import { buildCalculationDisplayTile } from "./projectImpactStoryCalculationDisplay.js";
import { collectGroundedCalculationIds } from "./projectImpactStoryGrounding.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

interface BuildProjectImpactStoryAssemblyInputActivity {
  id: string;
  name: string;
}

interface BuildProjectImpactStoryAssemblyInputUpload {
  id: string;
  activityId: string;
}

export interface ProjectImpactStoryNarrativeInputTile {
  label: string;
  description: string;
  value: number;
  formatAs: ImpactIndicatorTileFormat;
}

export interface ProjectImpactStoryNarrativeInputActivity {
  activityId: string;
  activityName: string;
  tiles: ProjectImpactStoryNarrativeInputTile[];
}

interface BuildProjectImpactStoryAssemblyInput {
  activities: BuildProjectImpactStoryAssemblyInputActivity[];
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[];
  uploads: BuildProjectImpactStoryAssemblyInputUpload[];
  language: "de" | "en";
}

interface BuildProjectImpactStoryAssemblyResult {
  activityCards: ActivityImpactStoryCard[];
  sourceSnapshot: ProjectImpactStorySourceSnapshotItem[];
  diagnostics: ProjectImpactStoryDiagnostics;
  narrativeInput: ProjectImpactStoryNarrativeInputActivity[];
}

export function buildProjectImpactStoryAssembly(
  input: BuildProjectImpactStoryAssemblyInput,
): BuildProjectImpactStoryAssemblyResult {
  const { latestRunsByActivityId, activitiesExcludedIds } =
    selectCurrentV2RunsByActivity(
      input.activities,
      input.activityAnalysisRuns,
      input.uploads,
    );

  const activityNameById = new Map(
    input.activities.map((activity) => [activity.id, activity.name]),
  );

  const sourceSnapshot: ProjectImpactStorySourceSnapshotItem[] = [];
  const activityCards: ActivityImpactStoryCard[] = [];
  const narrativeInput: ProjectImpactStoryNarrativeInputActivity[] = [];
  const activitiesWithNoGroundedIndicators: string[] = activitiesExcludedIds
    .map((id) => activityNameById.get(id))
    .filter((name): name is string => Boolean(name));
  let indicatorCount = 0;
  let excludedIndicatorCount = 0;

  for (const activity of input.activities) {
    const run = latestRunsByActivityId.get(activity.id);
    if (!run) {
      continue;
    }

    sourceSnapshot.push({
      activityId: activity.id,
      activityAnalysisRunId: run.id,
    });

    const groundedCalculationIds = collectGroundedCalculationIds(run);
    const tiles: ImpactIndicatorTile[] = [];
    const narrativeTiles: ProjectImpactStoryNarrativeInputTile[] = [];

    for (const calculation of run.calculations) {
      if (!groundedCalculationIds.has(calculation.calculationId)) {
        continue;
      }

      const tile = buildCalculationDisplayTile(calculation, input.language);
      if (!tile) {
        excludedIndicatorCount += 1;
        continue;
      }

      tiles.push(tile);
      indicatorCount += 1;
      if (tile.kind === "kpi" && tile.value !== null) {
        narrativeTiles.push({
          label: tile.label,
          description: tile.description,
          value: tile.value,
          formatAs: tile.formatAs,
        });
      }
    }

    if (tiles.length > 0) {
      activityCards.push({
        activityId: activity.id,
        activityName: activity.name,
        tiles,
      });
    } else {
      activitiesWithNoGroundedIndicators.push(activity.name);
    }

    if (narrativeTiles.length > 0) {
      narrativeInput.push({
        activityId: activity.id,
        activityName: activity.name,
        tiles: narrativeTiles,
      });
    }
  }

  return {
    activityCards,
    sourceSnapshot,
    diagnostics: {
      activityCount: input.activities.length,
      indicatorCount,
      excludedIndicatorCount,
      activitiesWithNoGroundedIndicators,
    },
    narrativeInput,
  };
}
