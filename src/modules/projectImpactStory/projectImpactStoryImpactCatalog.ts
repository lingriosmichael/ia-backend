import type { FastifyBaseLogger } from "fastify";
import type {
  ActivityAnalysisRunV2RunLimits,
  ImpactCatalogEntry,
  ImpactCatalogItem,
  OutcomeDistributionEntry,
  PairedCategoricalShiftEntry,
} from "../../shared/contracts.js";
import { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "../interpretation/activityAnalysisV2ToolTypes.js";
import {
  CurrentActivityEvidenceLoader,
  type CurrentActivityEvidenceItem,
  type CurrentActivityEvidenceSnapshot,
} from "../interpretation/currentActivityEvidenceLoader.js";
import { humanizeColumnName } from "../interpretation/activityAnalysisV2Service.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "../outcome/projectOutcomeStatementPersistence.js";
import { databaseSession } from "../../shared/database/databaseClient.js";

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

// Distinguishes "the join/measurement genuinely produced no usable pairing"
// (e.g. a candidate matchKey that doesn't actually match respondents, or a
// confirmed link whose evidence changed shape since confirmation) from any
// other failure (a broken tool-executor call, a network error). Callers
// that try multiple candidate keys — see
// outcomeEvidenceRecommendationApprovalService.ts's
// selectBestMatchKeyOrThrow/selectBestCategoricalShiftMatchKeyOrThrow — need
// this distinction to know a caught error means "try the next candidate"
// rather than "abort, something is actually broken."
export class PairedMeasurementNoUsableResultError extends Error {}

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

export interface PairedCategoricalShiftMeasurement {
  beforeShares: { labelDe: string; count: number }[];
  afterShares: { labelDe: string; count: number }[];
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
  if (
    !pairedChangeResult ||
    typeof pairedChangeResult.pairedCount !== "number" ||
    typeof pairedChangeResult.meanPre !== "number" ||
    typeof pairedChangeResult.meanPost !== "number"
  ) {
    throw new PairedMeasurementNoUsableResultError(
      `paired_change did not return a usable result for ${pair.beforeTableName} -> ${pair.afterTableName} on ${pair.matchKey}`,
    );
  }

  return {
    // meanPre/meanPost are a raw division (sum of Likert-scale responses /
    // pairedCount) and routinely land on a long repeating decimal (e.g.
    // 105 respondents -> 2.8095238095238093) that no UI ever wants to show
    // verbatim. Charts already round for display via
    // formatImpactStoryValue's Intl.NumberFormat, but the narrative LLM is
    // deliberately required to cite a paired_delta's before/after value
    // "exactly as given, never rounded" (see
    // ia_python_service/app/project_impact_story/narrative.py) — grounding
    // would otherwise have no way to tell a legitimate rounding from a
    // fabricated number. So the value must already be display-clean by the
    // time it becomes "the real value" here, one decimal place matching
    // both the chart's own display precision and the deterministic
    // fallback narrative's formatFallbackDecimal.
    beforeValue: roundToOneDecimal(pairedChangeResult.meanPre),
    afterValue: roundToOneDecimal(pairedChangeResult.meanPost),
    nMatched: pairedChangeResult.pairedCount,
    nBaseline,
  };
}

export async function computePairedCategoricalShiftMeasurement(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
  pair: PairedDeltaPairingShape,
): Promise<PairedCategoricalShiftMeasurement> {
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
      toolName: "paired_category_shift",
      alias: "shift",
      arguments: {
        resultAlias: "joined",
        entityColumnName: pair.matchKey,
        beforeCategoryColumnName: `before_${pair.beforeColumnName}`,
        afterCategoryColumnName: `after_${pair.afterColumnName}`,
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
  const pairedShiftResult = execution.calculations.find(
    (c) => c.toolName === "paired_category_shift",
  )?.result as
    | {
        pairedCount?: number;
        beforeCounts?: Array<{ label?: string; count?: number }>;
        afterCounts?: Array<{ label?: string; count?: number }>;
      }
    | undefined;
  if (
    !pairedShiftResult ||
    typeof pairedShiftResult.pairedCount !== "number" ||
    pairedShiftResult.pairedCount === 0 ||
    !Array.isArray(pairedShiftResult.beforeCounts) ||
    !Array.isArray(pairedShiftResult.afterCounts)
  ) {
    // pairedCount === 0 is checked explicitly (unlike computePairedDeltaMeasurement's
    // sibling check above) because an empty join here still produces a
    // type-valid result — pairedCount: 0 and beforeCounts/afterCounts: []
    // both pass the type checks alone, which would otherwise let a failed
    // join silently resolve as a zero-evidence entry instead of erroring.
    throw new PairedMeasurementNoUsableResultError(
      `paired_category_shift did not return a usable result for ${pair.beforeTableName} -> ${pair.afterTableName} on ${pair.matchKey}`,
    );
  }

  const normalizeCounts = (counts: Array<{ label?: string; count?: number }>) =>
    counts
      .filter(
        (group): group is { label: string; count: number } =>
          typeof group.label === "string" && typeof group.count === "number",
      )
      .map((group) => ({ labelDe: group.label, count: group.count }));

  return {
    beforeShares: normalizeCounts(pairedShiftResult.beforeCounts),
    afterShares: normalizeCounts(pairedShiftResult.afterCounts),
    nMatched: pairedShiftResult.pairedCount,
    nBaseline,
  };
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §3 — a bare table name is
// frequently the raw upload filename stem (evidence_parser.py derives
// sheet_name from it for single-sheet uploads), never a human
// description. There is no richer field to look up (UploadMetadata has
// none), so this pairs the table name with its owning activity's real,
// human-authored name instead — strictly more context than a bare table
// name, with no schema change. The table name itself is still shown, just
// run through the same humanizeColumnName underscore/casing cleanup this
// module already uses for column names — real improvement on a messy
// filename stem, but not a substitute for an actual human-authored label,
// which would need a genuine UploadMetadata field, not a formatting trick.
// Falls back to the bare table name if the activity can't be resolved
// (never throws over cosmetic metadata).
function buildSingleTableSourceCaptionDe(
  activityNameById: Map<string, string>,
  activityId: string,
  tableName: string,
): string {
  const activityName = activityNameById.get(activityId);
  const humanizedTableName = humanizeColumnName(tableName);
  return activityName
    ? `Quelle: ${activityName} — ${humanizedTableName}`
    : `Quelle: ${humanizedTableName}`;
}

// Same rationale as buildSingleTableSourceCaptionDe, for a before/after
// pair. Names the activity once, not twice, when both sides belong to the
// same activity (the common case post-outcome-evidence-merge, where
// before/after live on one merged system activity) — repeating an
// identical activity name on both sides of the arrow would be noise, not
// context.
function buildPairedSourceCaptionDe(
  activityNameById: Map<string, string>,
  beforeActivityId: string,
  beforeTableName: string,
  afterActivityId: string,
  afterTableName: string,
): string {
  const beforeActivityName = activityNameById.get(beforeActivityId);
  const afterActivityName = activityNameById.get(afterActivityId);
  const humanizedBeforeTableName = humanizeColumnName(beforeTableName);
  const humanizedAfterTableName = humanizeColumnName(afterTableName);
  const beforeLabel = beforeActivityName
    ? `${beforeActivityName} — ${humanizedBeforeTableName}`
    : humanizedBeforeTableName;
  const afterLabel =
    afterActivityName && afterActivityName !== beforeActivityName
      ? `${afterActivityName} — ${humanizedAfterTableName}`
      : humanizedAfterTableName;
  return `Quelle: ${beforeLabel} → ${afterLabel}`;
}

function findPreparedScaleDirection(
  preparation: DatasetPreparationPersistenceRecord | undefined,
  tableName: string,
  columnName: string,
): "higher_is_better" | "lower_is_better" | null {
  const table = preparation?.preparedDataset?.tables.find(
    (candidate) => candidate.name === tableName,
  );
  const column = table?.columns.find(
    (candidate) => candidate.name === columnName,
  );
  return column?.scaleDirection ?? null;
}

// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §4 consumer 1. Conservative by
// design: either column declaring "lower_is_better" is enough to mark the
// whole pair reverse-scored, even if the other column disagrees or was
// never answered — a false "exclude from the shared chart" costs nothing
// but a slightly smaller group chart; a false "include" would misrepresent
// a reverse-scored measurement as if higher were better, the exact failure
// this consumer exists to prevent. Never throws — any lookup failure
// (evidence re-uploaded since confirmation, question never asked) resolves
// to null (treated as "not reverse-scored, include") rather than failing
// the whole pair the way computePairedDeltaMeasurement's own failures do;
// this metadata is supplementary, not part of the core measurement.
async function resolvePairedDeltaScaleDirection(
  deps: {
    interpretationResultRepository: InterpretationResultRepository;
    datasetPreparationRepository: DatasetPreparationRepository;
  },
  link: Extract<
    OutcomeEvidenceLinkPersistenceRecord,
    { shape: "paired_delta" }
  >,
): Promise<"higher_is_better" | "lower_is_better" | null> {
  try {
    const results =
      await deps.interpretationResultRepository.findLatestByUploadMetadataIds(
        [link.beforeUploadMetadataId, link.afterUploadMetadataId],
        databaseSession,
      );
    if (results.length === 0) {
      return null;
    }

    const preparations =
      await deps.datasetPreparationRepository.findByInterpretationResultIds(
        results.map((result) => result.id),
        databaseSession,
      );
    const preparationByUploadId = new Map(
      preparations.map((preparation) => [
        preparation.uploadMetadataId,
        preparation,
      ]),
    );

    const beforeDirection = findPreparedScaleDirection(
      preparationByUploadId.get(link.beforeUploadMetadataId),
      link.beforeTableName,
      link.beforeColumnName,
    );
    const afterDirection = findPreparedScaleDirection(
      preparationByUploadId.get(link.afterUploadMetadataId),
      link.afterTableName,
      link.afterColumnName,
    );

    if (
      beforeDirection === "lower_is_better" ||
      afterDirection === "lower_is_better"
    ) {
      return "lower_is_better";
    }
    if (
      beforeDirection === "higher_is_better" &&
      afterDirection === "higher_is_better"
    ) {
      return "higher_is_better";
    }
    return null;
  } catch {
    return null;
  }
}

async function buildPairedDeltaEntry(
  deps: {
    currentActivityEvidenceLoader: CurrentActivityEvidenceLoader;
    activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor;
    interpretationResultRepository: InterpretationResultRepository;
    datasetPreparationRepository: DatasetPreparationRepository;
    activityNameById: Map<string, string>;
  },
  link: Extract<
    OutcomeEvidenceLinkPersistenceRecord,
    { shape: "paired_delta" }
  >,
  outcome: ProjectOutcomeStatementPersistenceRecord,
): Promise<ImpactCatalogEntry> {
  const measurement = await computePairedDeltaMeasurement(
    deps.currentActivityEvidenceLoader,
    deps.activityAnalysisV2ToolExecutor,
    link,
  );
  const scaleDirection = await resolvePairedDeltaScaleDirection(deps, link);

  return {
    entryId: link.linkId,
    shape: "paired_delta",
    outcomeId: outcome.id,
    outcomeTerm: outcome.term,
    outcomeStatement: outcome.statement,
    pairLabelDe: buildPairLabelDe(link.pairingGroupKey),
    ...measurement,
    sourceDe: buildPairedSourceCaptionDe(
      deps.activityNameById,
      link.activityIdBefore,
      link.beforeTableName,
      link.activityIdAfter,
      link.afterTableName,
    ),
    scaleDirection,
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
  activityNameById: Map<string, string>,
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
    sourceDe: buildSingleTableSourceCaptionDe(
      activityNameById,
      link.activityId,
      link.tableName,
    ),
  };
}

async function buildPairedCategoricalShiftEntry(
  currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
  activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
  link: Extract<
    OutcomeEvidenceLinkPersistenceRecord,
    { shape: "paired_categorical_shift" }
  >,
  outcome: ProjectOutcomeStatementPersistenceRecord,
  activityNameById: Map<string, string>,
): Promise<PairedCategoricalShiftEntry> {
  const measurement = await computePairedCategoricalShiftMeasurement(
    currentActivityEvidenceLoader,
    activityAnalysisV2ToolExecutor,
    link,
  );

  return {
    entryId: link.linkId,
    shape: "paired_categorical_shift",
    outcomeId: outcome.id,
    outcomeTerm: outcome.term,
    outcomeStatement: outcome.statement,
    pairLabelDe: humanizeColumnName(link.pairLabelColumnName),
    ...measurement,
    sourceDe: buildPairedSourceCaptionDe(
      activityNameById,
      link.activityIdBefore,
      link.beforeTableName,
      link.activityIdAfter,
      link.afterTableName,
    ),
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
    interpretationResultRepository: InterpretationResultRepository;
    datasetPreparationRepository: DatasetPreparationRepository;
    activityNameById: Map<string, string>;
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
              {
                currentActivityEvidenceLoader:
                  deps.currentActivityEvidenceLoader,
                activityAnalysisV2ToolExecutor:
                  deps.activityAnalysisV2ToolExecutor,
                interpretationResultRepository:
                  deps.interpretationResultRepository,
                datasetPreparationRepository: deps.datasetPreparationRepository,
                activityNameById: deps.activityNameById,
              },
              link,
              outcomeStatement,
            ),
          );
        } else if (link.shape === "paired_categorical_shift") {
          items.push(
            await buildPairedCategoricalShiftEntry(
              deps.currentActivityEvidenceLoader,
              deps.activityAnalysisV2ToolExecutor,
              link,
              outcomeStatement,
              deps.activityNameById,
            ),
          );
        } else {
          items.push(
            await buildSingleDistributionEntry(
              deps.currentActivityEvidenceLoader,
              deps.activityAnalysisV2ToolExecutor,
              link,
              outcomeStatement,
              deps.activityNameById,
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
