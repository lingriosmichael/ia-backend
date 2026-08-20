import type { ContextCatalogEntry } from "../../shared/contracts.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import { selectCurrentV2RunsByActivity } from "./projectImpactStoryV2RunSelection.js";

interface ProjectImpactStoryContextCatalogInputActivity {
  id: string;
  name: string;
}

interface ProjectImpactStoryContextCatalogInputUpload {
  id: string;
  activityId: string;
}

const PROJECT_IMPACT_STORY_CONTEXT_CHART_COUNT = 2;

// Ranks every current activity's ContextCatalogEntry candidates (pure
// descriptive distributions with no goal or outcome link — see
// activity_analysis_runs_v2.contextCatalogEntries) and returns the top N
// project-wide by sample size (n). This is now only a deterministic
// fallback pool for when the chart planner yields no selected charts; the
// planner's main catalog can already see descriptive distributions directly.
export function buildProjectImpactStoryContextCatalog(
  activities: ProjectImpactStoryContextCatalogInputActivity[],
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[],
  uploads: ProjectImpactStoryContextCatalogInputUpload[],
): ContextCatalogEntry[] {
  const { latestRunsByActivityId } = selectCurrentV2RunsByActivity(
    activities,
    activityAnalysisRuns,
    uploads,
  );

  const candidates: ContextCatalogEntry[] = [];
  for (const activity of activities) {
    const run = latestRunsByActivityId.get(activity.id);
    if (!run) {
      continue;
    }
    candidates.push(...run.contextCatalogEntries);
  }

  return candidates
    .slice()
    .sort((left, right) => right.n - left.n)
    .slice(0, PROJECT_IMPACT_STORY_CONTEXT_CHART_COUNT);
}
