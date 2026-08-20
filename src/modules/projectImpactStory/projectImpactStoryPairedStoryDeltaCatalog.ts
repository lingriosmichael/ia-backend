import type { FastifyBaseLogger } from "fastify";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import {
  buildPairedDeltaProposalId,
  computeOutcomeEvidencePairingCandidates,
} from "../outcome/outcomeEvidencePairingCandidateMatcher.js";
import {
  loadProjectEvidenceTablesForStoryPairing,
  type OutcomeEvidencePairingEvidenceLoaderDependencies,
} from "../outcome/outcomeEvidencePairingEvidenceLoader.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import {
  buildPairLabelDe,
  computePairedDeltaMeasurement,
} from "./projectImpactStoryImpactCatalog.js";

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

// Below this, a "trend" is more likely noise than a real pattern — same
// spirit as any minimum-sample-size guard, chosen conservatively since
// this shape is exploratory (no human has confirmed it as real outcome
// evidence) and therefore gets no other sanity check before reaching the
// chart planner.
const MIN_PAIRED_STORY_DELTA_MATCHED_ROWS = 5;

// Exploratory story-chart counterpart to buildProjectImpactStoryImpactCatalog:
// same declared-pairing detection (computeOutcomeEvidencePairingCandidates)
// and the same join_tables + paired_change measurement
// (computePairedDeltaMeasurement), but sourced from every activity in the
// project (loadProjectEvidenceTablesForStoryPairing), not just the two
// system activities, and never requiring a human-confirmed
// OutcomeEvidenceLink first. A candidate that *is* already confirmed is
// deliberately excluded — it already has a better, claim-safe home in
// impactCatalog, and must never also appear here as merely "exploratory."
//
// Every returned entry is unconfirmed, declared-metadata-only evidence —
// never proof of outcome change. Callers must render it visually distinct
// from impactCatalog (see ProjectImpactStoryChartSpec.isExploratory).
export async function buildProjectImpactStoryPairedStoryDeltaCatalog(
  deps: {
    outcomeEvidencePairingEvidenceLoaderDependencies: OutcomeEvidencePairingEvidenceLoaderDependencies;
    currentActivityEvidenceLoader: CurrentActivityEvidenceLoader;
    activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor;
    logger: FastifyBaseLogger;
  },
  projectId: string,
  activities: ProjectImpactStoryPairedStoryDeltaCatalogInputActivity[],
  confirmedLinks: OutcomeEvidenceLinkPersistenceRecord[],
): Promise<ProjectImpactStoryCatalogPairedStoryDeltaEntry[]> {
  const tables = await loadProjectEvidenceTablesForStoryPairing(
    deps.outcomeEvidencePairingEvidenceLoaderDependencies,
    projectId,
  );
  if (tables.length === 0) {
    return [];
  }

  const pairedDeltaCandidates = computeOutcomeEvidencePairingCandidates(
    tables,
  ).filter((candidate) => candidate.shape === "paired_delta");
  if (pairedDeltaCandidates.length === 0) {
    return [];
  }

  const confirmedProposalIds = new Set(
    confirmedLinks
      .filter((link) => link.shape === "paired_delta")
      .map((link) =>
        buildPairedDeltaProposalId(
          {
            uploadMetadataId: link.beforeUploadMetadataId,
            tableName: link.beforeTableName,
            columnName: link.beforeColumnName,
          },
          {
            uploadMetadataId: link.afterUploadMetadataId,
            tableName: link.afterTableName,
            columnName: link.afterColumnName,
          },
        ),
      ),
  );

  const activityNameById = new Map(
    activities.map((activity) => [activity.id, activity.name]),
  );

  const entries: ProjectImpactStoryCatalogPairedStoryDeltaEntry[] = [];
  for (const candidate of pairedDeltaCandidates) {
    if (confirmedProposalIds.has(candidate.proposalId)) {
      continue;
    }

    let measurement;
    try {
      measurement = await computePairedDeltaMeasurement(
        deps.currentActivityEvidenceLoader,
        deps.activityAnalysisV2ToolExecutor,
        candidate,
      );
    } catch (error) {
      deps.logger.warn(
        { err: error, proposalId: candidate.proposalId },
        "paired story delta candidate could not be measured against current evidence; skipping",
      );
      continue;
    }

    if (measurement.nMatched < MIN_PAIRED_STORY_DELTA_MATCHED_ROWS) {
      continue;
    }

    entries.push({
      kind: "paired_story_delta",
      entryId: `story:paired_delta:${candidate.proposalId}`,
      activityId: candidate.activityIdBefore,
      activityName:
        activityNameById.get(candidate.activityIdBefore) ??
        candidate.activityIdBefore,
      pairLabelDe: buildPairLabelDe(candidate.pairingGroupKey),
      sourceDe: `Quelle: ${candidate.beforeTableName} → ${candidate.afterTableName}`,
      ...measurement,
    });
  }

  return entries;
}
