import type {
  OutcomeEvidencePairingProposal,
  OutcomeEvidencePairingProposalPairedDelta,
  OutcomeEvidencePairingProposalSingleDistribution,
  PreparedDatasetColumn,
} from "../../shared/contracts.js";
import type { OutcomeEvidencePairingEvidenceTable } from "./outcomeEvidencePairingEvidenceLoader.js";

export function normalizeColumnName(columnName: string): string {
  return columnName.trim().toLowerCase().replace(/\s+/g, " ");
}

export function canSafelyPairEvidenceTables(
  before: OutcomeEvidencePairingEvidenceTable,
  after: OutcomeEvidencePairingEvidenceTable,
): boolean {
  if (
    !before.identifierColumn ||
    !after.identifierColumn ||
    normalizeColumnName(before.identifierColumn) !==
      normalizeColumnName(after.identifierColumn)
  ) {
    return false;
  }

  if (
    before.hasDuplicateIdentifierValues ||
    after.hasDuplicateIdentifierValues
  ) {
    return false;
  }

  // Declared, not sniffed from row content (see cohort_tag preparation
  // question) — the authoritative signal for "these two tables are about
  // the same cohort." A table with no declared tag is treated as "single
  // cohort, no scoping needed" so a project that never needed this
  // question keeps today's default behavior.
  if (
    before.cohortTag &&
    after.cohortTag &&
    normalizeColumnName(before.cohortTag) !==
      normalizeColumnName(after.cohortTag)
  ) {
    return false;
  }

  return true;
}

// Two validated_scale columns that share a name/stem can still be genuinely
// different instruments (e.g. a 1-5 baseline scale replaced by a 0-10
// endline one between waves) — pairing them would silently produce a
// numerically meaningless delta. Require both sides' observed bounds to be
// known and equal; unknown bounds on either side is not treated as a match
// (a project that never had this data cannot benefit from a check it never
// had, but a bounds *mismatch* must always block the pair).
export function hasCompatibleScaleBounds(
  before: { minValue?: number | null; maxValue?: number | null },
  after: { minValue?: number | null; maxValue?: number | null },
): boolean {
  return (
    before.minValue !== null &&
    before.minValue !== undefined &&
    before.maxValue !== null &&
    before.maxValue !== undefined &&
    after.minValue !== null &&
    after.minValue !== undefined &&
    after.maxValue !== null &&
    after.maxValue !== undefined &&
    before.minValue === after.minValue &&
    before.maxValue === after.maxValue
  );
}

export function buildPairedDeltaProposalId(
  before: { uploadMetadataId: string; tableName: string; columnName: string },
  after: { uploadMetadataId: string; tableName: string; columnName: string },
): string {
  return [
    "paired_delta",
    before.uploadMetadataId,
    before.tableName,
    before.columnName,
    after.uploadMetadataId,
    after.tableName,
    after.columnName,
  ].join("|");
}

export function buildSingleDistributionProposalId(entry: {
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
}): string {
  return [
    "single_distribution",
    entry.uploadMetadataId,
    entry.tableName,
    entry.columnName,
  ].join("|");
}

interface TaggedPairingColumn {
  table: OutcomeEvidencePairingEvidenceTable;
  column: PreparedDatasetColumn;
}

/**
 * Sole paired_delta detection path: a human explicitly tags a validated_scale
 * column with a pairing_group_key (a short instrument label, e.g. "Wellbeing
 * scale") and a pairing_group_role ("before"/"after") during interpretation
 * review — see datasetPreparationService.ts. Any two such columns anywhere
 * in the project sharing a normalized pairingGroupKey with opposite roles
 * become a candidate, still gated by canSafelyPairEvidenceTables (shared
 * identifier, no duplicate keys, matching cohort tag) and
 * hasCompatibleScaleBounds.
 *
 * This replaces the previous systemType/marker-token heuristic detection.
 * Inferring pairing identity from column-name vocabulary or which system
 * activity a table happened to belong to cannot be made reliably generic
 * against arbitrary user-authored files and column names — see the
 * corresponding critique in IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md.
 * Pairing identity is now a declared fact a human confirms once, not a
 * guess, matching how positive_status_values/epistemic_role_clarification
 * already resolve other ambiguous column semantics in this pipeline.
 */
function computeDeclaredPairingGroupCandidates(
  tables: OutcomeEvidencePairingEvidenceTable[],
): OutcomeEvidencePairingProposalPairedDelta[] {
  const beforeByGroupKey = new Map<string, TaggedPairingColumn[]>();
  const afterByGroupKey = new Map<string, TaggedPairingColumn[]>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (
        column.epistemicRole !== "validated_scale" ||
        !column.pairingGroupKey
      ) {
        continue;
      }
      const bucket =
        column.pairingGroupRole === "before"
          ? beforeByGroupKey
          : column.pairingGroupRole === "after"
            ? afterByGroupKey
            : null;
      if (!bucket) {
        continue;
      }
      const normalizedKey = normalizeColumnName(column.pairingGroupKey);
      const entries = bucket.get(normalizedKey) ?? [];
      entries.push({ table, column });
      bucket.set(normalizedKey, entries);
    }
  }

  const proposals: OutcomeEvidencePairingProposalPairedDelta[] = [];
  const seenProposalIds = new Set<string>();

  for (const [normalizedKey, beforeEntries] of beforeByGroupKey) {
    const afterEntries = afterByGroupKey.get(normalizedKey) ?? [];
    for (const before of beforeEntries) {
      for (const after of afterEntries) {
        if (!hasCompatibleScaleBounds(before.column, after.column)) {
          continue;
        }
        if (!canSafelyPairEvidenceTables(before.table, after.table)) {
          continue;
        }
        const matchKey = before.table.identifierColumn;
        if (!matchKey) {
          continue;
        }

        const proposalId = buildPairedDeltaProposalId(
          {
            uploadMetadataId: before.table.uploadMetadataId,
            tableName: before.table.tableName,
            columnName: before.column.name,
          },
          {
            uploadMetadataId: after.table.uploadMetadataId,
            tableName: after.table.tableName,
            columnName: after.column.name,
          },
        );
        if (seenProposalIds.has(proposalId)) {
          continue;
        }
        seenProposalIds.add(proposalId);

        proposals.push({
          proposalId,
          shape: "paired_delta",
          activityIdBefore: before.table.activityId,
          activityIdAfter: after.table.activityId,
          beforeUploadMetadataId: before.table.uploadMetadataId,
          beforeTableName: before.table.tableName,
          beforeColumnName: before.column.name,
          afterUploadMetadataId: after.table.uploadMetadataId,
          afterTableName: after.table.tableName,
          afterColumnName: after.column.name,
          matchKey,
          // Non-null: this loop only ever runs for columns that already
          // passed the `!column.pairingGroupKey` guard above.
          pairingGroupKey: before.column.pairingGroupKey as string,
          suggestedOutcome: null,
        });
      }
    }
  }

  return proposals;
}

/**
 * Deterministic, non-LLM candidate detection for outcome-evidence pairing:
 * - paired_delta: found solely from declared pairing_group_key/role answers
 *   (see computeDeclaredPairingGroupCandidates above).
 * - single_distribution: any categorical column not already claimed by a
 *   paired_delta candidate (e.g. "which next step did you take").
 *
 * Every candidate is proposed only — which declared outcome it belongs to
 * is always a closed-list human pick (see OutcomeEvidencePairingProposalDecision).
 */
export function computeOutcomeEvidencePairingCandidates(
  tables: OutcomeEvidencePairingEvidenceTable[],
): OutcomeEvidencePairingProposal[] {
  const pairedDeltaProposals = computeDeclaredPairingGroupCandidates(tables);
  const claimedColumnKeys = new Set<string>();
  for (const proposal of pairedDeltaProposals) {
    claimedColumnKeys.add(
      `${proposal.beforeUploadMetadataId}|${proposal.beforeTableName}|${proposal.beforeColumnName}`,
    );
    claimedColumnKeys.add(
      `${proposal.afterUploadMetadataId}|${proposal.afterTableName}|${proposal.afterColumnName}`,
    );
  }

  const singleDistributionProposals: OutcomeEvidencePairingProposalSingleDistribution[] =
    [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.epistemicRole !== "categorical") {
        continue;
      }
      const key = `${table.uploadMetadataId}|${table.tableName}|${column.name}`;
      if (claimedColumnKeys.has(key)) {
        continue;
      }
      singleDistributionProposals.push({
        proposalId: buildSingleDistributionProposalId({
          uploadMetadataId: table.uploadMetadataId,
          tableName: table.tableName,
          columnName: column.name,
        }),
        shape: "single_distribution",
        activityId: table.activityId,
        uploadMetadataId: table.uploadMetadataId,
        tableName: table.tableName,
        categoryColumnName: column.name,
        suggestedOutcome: null,
      });
    }
  }

  return [...pairedDeltaProposals, ...singleDistributionProposals];
}
