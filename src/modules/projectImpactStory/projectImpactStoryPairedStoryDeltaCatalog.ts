import type { FastifyBaseLogger } from "fastify";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import type { OutcomeEvidencePairingEvidenceLoaderDependencies } from "../outcome/outcomeEvidencePairingEvidenceLoader.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";

export interface ProjectImpactStoryCatalogPairedStoryDeltaEntry {
  kind: "paired_story_delta";
  entryId: string;
  activityId: string;
  activityName: string;
  pairLabelDe: string;
  beforeValue: number;
  afterValue: number;
  nMatched: number;
  nBaseline: number;
  sourceDe: string;
}

interface ProjectImpactStoryPairedStoryDeltaCatalogInputActivity {
  id: string;
  name: string;
}

/**
 * Exploratory story-chart lane: used to surface unconfirmed "this looks
 * like a before/after pair" chart suggestions across every activity in a
 * project, via computeOutcomeEvidencePairingCandidates's declared
 * pairing_group_key/pairing_group_role scan. That scan (and the
 * clarification questions that ever populated those fields) was removed in
 * OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 6 as part of replacing the whole
 * declared-pairing mechanism with the new LLM-based recommendation flow —
 * a known, accepted, one-way consequence for this unrelated feature (see
 * that plan's Phase 6 notes), not a bug. Nothing can ever populate those
 * fields again, so this can only ever return an empty list now.
 *
 * Kept as a function, not deleted outright: `ProjectImpactStoryCatalogPairedStoryDeltaEntry`
 * is still a real chart-entry kind rendered elsewhere
 * (projectImpactStoryCatalog.ts, projectImpactStoryChartBacklog.ts,
 * projectImpactStoryChartPlanExecution.ts) for already-materialized
 * historical results, and this keeps that call site
 * (projectImpactStoryService.ts) unchanged.
 */
export async function buildProjectImpactStoryPairedStoryDeltaCatalog(
  _deps: {
    outcomeEvidencePairingEvidenceLoaderDependencies: OutcomeEvidencePairingEvidenceLoaderDependencies;
    currentActivityEvidenceLoader: CurrentActivityEvidenceLoader;
    activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor;
    logger: FastifyBaseLogger;
  },
  _projectId: string,
  _activities: ProjectImpactStoryPairedStoryDeltaCatalogInputActivity[],
  _confirmedLinks: OutcomeEvidenceLinkPersistenceRecord[],
): Promise<ProjectImpactStoryCatalogPairedStoryDeltaEntry[]> {
  return [];
}
