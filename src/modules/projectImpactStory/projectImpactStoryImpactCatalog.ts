import type { FastifyBaseLogger } from "fastify";
import type {
  ActivityAnalysisRunV2RunLimits,
  ImpactCatalogEntry,
  ImpactCatalogItem,
  OutcomeDistributionEntry,
} from "../../shared/contracts.js";
import { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "../interpretation/activityAnalysisV2ToolTypes.js";
import {
  CurrentActivityEvidenceLoader,
  type CurrentActivityEvidenceItem,
  type CurrentActivityEvidenceSnapshot,
} from "../interpretation/currentActivityEvidenceLoader.js";
import { humanizeColumnName } from "../interpretation/activityAnalysisV2Service.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "../outcome/projectOutcomeStatementPersistence.js";

// A single small, fixed-cost tool-executor call per pair — never an
// LLM-planned batch, so a generous maxToolCalls headroom is unnecessary.
// timeoutMs is per-pair, not per-project: a slow/broken pair should not be
// able to starve the rest of the catalog of its own budget. Shared by both
// the confirmed impact catalog (below) and the exploratory paired-story-
// delta catalog (projectImpactStoryPairedStoryDeltaCatalog.ts).
const PAIRED_DELTA_MEASUREMENT_RUN_LIMITS: ActivityAnalysisRunV2RunLimits = {
  maxToolCalls: 5,
  maxLlmIterations: 1,
  timeoutMs: 30_000,
  maxEvidenceItems: 200,
};

// pairingGroupKey is the human-authored instrument label (e.g. "Wellbeing
// scale") declared via the pairing_group_key question — a better label
// than deriving one from the raw column name, and no longer tied to the
// removed marker-token vocabulary. Exported so
// projectImpactStoryPairedStoryDeltaCatalog.ts labels its own (unconfirmed)
// pairs identically rather than reimplementing this one-liner.
export function buildPairLabelDe(pairingGroupKey: string): string {
  return humanizeColumnName(pairingGroupKey);
}

// Common shape both a confirmed OutcomeEvidenceLinkPairedDelta and an
// unconfirmed OutcomeEvidencePairingProposalPairedDelta satisfy — the two
// types are structurally identical on every field this needs, so neither
// caller has to adapt its own shape to call this.
export interface PairedDeltaPairingShape {
  activityIdBefore: string;
  activityIdAfter: string;
  beforeUploadMetadataId: string;
  beforeTableName: string;
  beforeColumnName: string;
  afterUploadMetadataId: string;
  afterTableName: string;
  afterColumnName: string;
  matchKey: string;
}

export interface PairedDeltaMeasurement {
  beforeValue: number;
  afterValue: number;
  nMatched: number;
  nBaseline: number;
}

async function loadCombinedEvidenceSnapshot(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityIds: string[],
): Promise<CurrentActivityEvidenceSnapshot> {
  const uniqueActivityIds = [...new Set(activityIds)];
  const snapshots = await Promise.all(
    uniqueActivityIds.map((activityId) =>
      currentActivityEvidenceLoader.load(activityId),
    ),
  );

  const evidenceByUploadId = new Map<string, CurrentActivityEvidenceItem>();
  for (const snapshot of snapshots) {
    for (const item of snapshot.evidence) {
      evidenceByUploadId.set(item.uploadMetadataId, item);
    }
  }

  return {
    organizationId:
      snapshots.find((s) => s.organizationId)?.organizationId ?? null,
    projectId: snapshots.find((s) => s.projectId)?.projectId ?? null,
    activityId: uniqueActivityIds[0] ?? "",
    evidence: [...evidenceByUploadId.values()],
    missingPrivacySafeUploads: snapshots.flatMap(
      (s) => s.missingPrivacySafeUploads,
    ),
  };
}

// Shared by both the confirmed impact catalog (this file) and the
// exploratory paired-story-delta catalog
// (projectImpactStoryPairedStoryDeltaCatalog.ts) — the same
// join_tables + paired_change execution either way; only what becomes of
// the result (a claim-safe ImpactCatalogEntry vs. an exploratory story
// catalog entry) differs by caller.
export async function computePairedDeltaMeasurement(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
  pair: PairedDeltaPairingShape,
): Promise<PairedDeltaMeasurement> {
  const snapshot = await loadCombinedEvidenceSnapshot(
    currentActivityEvidenceLoader,
    [pair.activityIdBefore, pair.activityIdAfter],
  );

  const requests: ActivityAnalysisV2ToolRequest[] = [
    {
      toolName: "count_rows",
      arguments: {
        uploadMetadataId: pair.beforeUploadMetadataId,
        tableName: pair.beforeTableName,
      },
    },
    {
      toolName: "join_tables",
      alias: "joined",
      arguments: {
        left: {
          uploadMetadataId: pair.beforeUploadMetadataId,
          tableName: pair.beforeTableName,
        },
        right: {
          uploadMetadataId: pair.afterUploadMetadataId,
          tableName: pair.afterTableName,
        },
        keys: [
          { leftColumnName: pair.matchKey, rightColumnName: pair.matchKey },
        ],
        leftPrefix: "before",
        rightPrefix: "after",
      },
    },
    {
      toolName: "paired_change",
      alias: "delta",
      arguments: {
        resultAlias: "joined",
        entityColumnName: pair.matchKey,
        preColumnName: `before_${pair.beforeColumnName}`,
        postColumnName: `after_${pair.afterColumnName}`,
        outputColumnName: "delta",
      },
    },
  ];

  const execution = await activityAnalysisV2ToolExecutor.execute(
    requests,
    snapshot,
    PAIRED_DELTA_MEASUREMENT_RUN_LIMITS,
    Date.now(),
  );

  const nBaseline = Number(
    execution.calculations.find((c) => c.toolName === "count_rows")?.value ?? 0,
  );
  const pairedChangeResult = execution.calculations.find(
    (c) => c.toolName === "paired_change",
  )?.result;

  return {
    beforeValue: Number(pairedChangeResult?.meanPre ?? 0),
    afterValue: Number(pairedChangeResult?.meanPost ?? 0),
    nMatched: Number(pairedChangeResult?.pairedCount ?? 0),
    nBaseline,
  };
}

async function buildPairedDeltaEntry(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
  link: Extract<
    OutcomeEvidenceLinkPersistenceRecord,
    { shape: "paired_delta" }
  >,
  outcome: ProjectOutcomeStatementPersistenceRecord,
): Promise<ImpactCatalogEntry> {
  const measurement = await computePairedDeltaMeasurement(
    currentActivityEvidenceLoader,
    activityAnalysisV2ToolExecutor,
    link,
  );

  return {
    entryId: link.linkId,
    shape: "paired_delta",
    outcomeId: outcome.id,
    outcomeTerm: outcome.term,
    outcomeStatement: outcome.statement,
    pairLabelDe: buildPairLabelDe(link.pairingGroupKey),
    ...measurement,
    sourceDe: `Quelle: ${link.beforeTableName} → ${link.afterTableName}`,
  };
}

async function buildSingleDistributionEntry(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
  link: Extract<
    OutcomeEvidenceLinkPersistenceRecord,
    { shape: "single_distribution" }
  >,
  outcome: ProjectOutcomeStatementPersistenceRecord,
): Promise<OutcomeDistributionEntry> {
  const snapshot = await loadCombinedEvidenceSnapshot(
    currentActivityEvidenceLoader,
    [link.activityId],
  );

  const requests: ActivityAnalysisV2ToolRequest[] = [
    {
      toolName: "group_count",
      arguments: {
        uploadMetadataId: link.uploadMetadataId,
        tableName: link.tableName,
        columnName: link.categoryColumnName,
      },
    },
  ];

  const execution = await activityAnalysisV2ToolExecutor.execute(
    requests,
    snapshot,
    PAIRED_DELTA_MEASUREMENT_RUN_LIMITS,
    Date.now(),
  );

  const groups = Array.isArray(execution.calculations[0]?.result.groups)
    ? (execution.calculations[0]?.result.groups as Array<{
        value: string | null;
        count: number;
      }>)
    : [];
  const shares = groups
    .filter((group) => group.value !== null)
    .map((group) => ({ labelDe: group.value as string, count: group.count }));
  const n = shares.reduce((total, share) => total + share.count, 0);

  return {
    entryId: link.linkId,
    shape: "single_distribution",
    outcomeId: outcome.id,
    outcomeTerm: outcome.term,
    outcomeStatement: outcome.statement,
    questionLabelDe: humanizeColumnName(link.categoryColumnName),
    shares,
    n,
    sourceDe: `Quelle: ${link.tableName}`,
  };
}

// Builds the outcome-linked counterpart to ProjectImpactStoryCatalogEntry —
// the only catalog whose entries are allowed to reach the narrative LLM
// call (see IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §4.5/§4.6). Every value
// resolves from a human-confirmed OutcomeEvidenceLink via the same
// join/row-derivation tools ActivityAnalystV2 already implements — no new
// execution mechanism. A link whose evidence can no longer be resolved
// (e.g. re-uploaded since confirmation) is logged and skipped rather than
// failing the whole build, matching this codebase's general
// one-failure-must-not-block-the-rest posture.
export async function buildProjectImpactStoryImpactCatalog(
  deps: {
    currentActivityEvidenceLoader: CurrentActivityEvidenceLoader;
    activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor;
    logger: FastifyBaseLogger;
  },
  outcomeStatements: ProjectOutcomeStatementPersistenceRecord[],
  confirmedLinks: OutcomeEvidenceLinkPersistenceRecord[],
): Promise<ImpactCatalogItem[]> {
  const outcomeById = new Map(
    outcomeStatements.map((outcome) => [outcome.id, outcome]),
  );
  const linksByOutcomeId = new Map<
    string,
    OutcomeEvidenceLinkPersistenceRecord[]
  >();
  for (const link of confirmedLinks) {
    const existing = linksByOutcomeId.get(link.outcomeId) ?? [];
    existing.push(link);
    linksByOutcomeId.set(link.outcomeId, existing);
  }

  const items: ImpactCatalogItem[] = [];

  for (const outcome of outcomeStatements) {
    const links = linksByOutcomeId.get(outcome.id) ?? [];
    if (links.length === 0) {
      continue;
    }

    for (const link of links) {
      const outcomeStatement = outcomeById.get(link.outcomeId);
      if (!outcomeStatement) {
        continue;
      }

      try {
        if (link.shape === "paired_delta") {
          items.push(
            await buildPairedDeltaEntry(
              deps.currentActivityEvidenceLoader,
              deps.activityAnalysisV2ToolExecutor,
              link,
              outcomeStatement,
            ),
          );
        } else {
          items.push(
            await buildSingleDistributionEntry(
              deps.currentActivityEvidenceLoader,
              deps.activityAnalysisV2ToolExecutor,
              link,
              outcomeStatement,
            ),
          );
        }
      } catch (error) {
        deps.logger.warn(
          {
            err: error,
            linkId: link.linkId,
            outcomeId: link.outcomeId,
            shape: link.shape,
          },
          "impact catalog: confirmed OutcomeEvidenceLink could not be resolved against current evidence; skipping",
        );
      }
    }
  }

  return items;
}
