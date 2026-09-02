import { AppError } from "../../shared/errors/appError.js";
import type { UploadDatasetRole } from "../../shared/contracts.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "./outcomeEvidenceLinkPersistence.js";

// Same normalization the old, now-removed outcomeEvidencePairingCandidateMatcher.ts
// used (case/whitespace-insensitive) — kept identical so a column/cohort
// name that matched under the old proposal-time check still matches under
// this approval-time one.
export function normalizeOutcomeEvidenceMatchValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface OutcomeEvidencePairApprovalSafetyCheckTable {
  cohortTag?: string | null;
  datasetRole: UploadDatasetRole | null;
}

/**
 * Approval-time equivalent of the old, now-removed
 * outcomeEvidencePairingCandidateMatcher.ts's canSafelyPairEvidenceTables,
 * relocated per OUTCOME_EVIDENCE_MERGE_PLAN.md
 * §4.4 step 2: the old candidate matcher ran this at *proposal* time, to
 * decide whether a human-declared pairing_group_key pair was even worth
 * showing. Under the new design there is no human-declared pairing tag to
 * gate on before an LLM recommendation exists, so these checks move to
 * *approval* time instead — the same three checks, just gating "can this be
 * confirmed" rather than "can this be proposed." Cross-table identifier
 * choice itself is now handled later by approval-time candidate scoring
 * against the real rows, so this helper keeps only the still-global table
 * compatibility check that remains meaningful before a concrete join key
 * has been chosen.
 *
 * Throws AppError (409 — a conflict with existing declared/observed facts
 * about the data, not a validation failure) on the first check that fails,
 * rather than returning a boolean, so a caller can propagate a real HTTP
 * error without re-deriving which check failed.
 */
export function assertPairedDeltaApprovalIsSafe(
  before: OutcomeEvidencePairApprovalSafetyCheckTable,
  after: OutcomeEvidencePairApprovalSafetyCheckTable,
): void {
  // The check that matters most now that one merged activity can hold
  // multiple Zielgruppen (§3): a table with no declared cohortTag is
  // treated as "single cohort, no scoping needed," but two tables with
  // declared, different cohort tags are never the same before/after
  // respondent pool, even if Python's own grounding (§4.3) somehow let a
  // cross-cohort recommendation through.
  if (
    before.cohortTag &&
    after.cohortTag &&
    normalizeOutcomeEvidenceMatchValue(before.cohortTag) !==
      normalizeOutcomeEvidenceMatchValue(after.cohortTag)
  ) {
    throw new AppError(
      "The before and after tables declare different cohorts, so they cannot be paired as the same before/after respondent pool.",
      409,
      "outcome_evidence_pairing_cross_cohort_pairing_blocked",
    );
  }

  // The real trust boundary for pre/post direction (OUTCOME_EVIDENCE_MERGE_PLAN.md's
  // pre/post inversion fix): OutcomeEvidenceRecommendationService already
  // derives before/after from datasetRole for an LLM-sourced recommendation,
  // but this call is the only enforcement point for a manually submitted
  // pairing (see outcomeEvidenceRecommendationApprovalService.ts's manual-add
  // path, which never runs resolveRecommendation's grounding at all) and
  // the only one that re-checks against *current* data if a file's role
  // was reassigned after the recommendation was generated. Reject unless
  // the two sides are exactly one baseline upload + one follow-up upload —
  // never inferred from either table's name or column labels.
  const roles = new Set([
    before.datasetRole ?? null,
    after.datasetRole ?? null,
  ]);
  if (roles.has(null) || roles.size !== 2) {
    throw new AppError(
      "The before and after files must be exactly one classified as Ausgangslage (baseline) and one as Wirkungsdaten (follow-up) before this pairing can be confirmed.",
      409,
      "outcome_evidence_pairing_dataset_role_mismatch",
    );
  }
}

// hasCompatibleScaleBounds used to live here too (relocated, unchanged,
// from the old outcomeEvidencePairingCandidateMatcher.ts, per this file's
// own earlier Phase 2/3 history) — removed for real in Phase 6, per the
// plan's own flagged follow-up: it depended on scaleMin/scaleMax, which
// this same Phase 6 pass removes from PreparedDatasetColumn entirely (see
// OUTCOME_EVIDENCE_MERGE_PLAN.md §5), so nothing can ever populate them
// again and the function could only ever return false from here on.

// Composite proposal/link identity keys — relocated from the old, now-
// removed outcomeEvidencePairingCandidateMatcher.ts (Phase 6). Still real,
// still needed: OutcomeEvidenceRecommendationApprovalService uses these to
// detect an already-confirmed OutcomeEvidenceLink before persisting a
// duplicate.
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

export function buildPairedCategoricalShiftProposalId(
  before: { uploadMetadataId: string; tableName: string; columnName: string },
  after: { uploadMetadataId: string; tableName: string; columnName: string },
): string {
  return [
    "paired_categorical_shift",
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

// Recomputes a persisted link's proposal id from its own fields, so a
// caller holding an OutcomeEvidenceLinkPersistenceRecord (which does not
// itself carry proposalId — that field is persistence/dedup-only, see
// outcomeEvidenceLinkPersistence.ts) can compare it against a freshly
// built recommendation's proposal id. Used both by the approval service
// (detect an already-confirmed link before persisting a duplicate) and by
// OutcomeEvidenceRecommendationService (drop already-confirmed pairings
// from a fresh recommendation response before they ever reach a human).
export function buildProposalIdFromLink(
  link: OutcomeEvidenceLinkPersistenceRecord,
): string {
  if (link.shape === "paired_delta") {
    return buildPairedDeltaProposalId(
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
    );
  }
  if (link.shape === "paired_categorical_shift") {
    return buildPairedCategoricalShiftProposalId(
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
    );
  }

  return buildSingleDistributionProposalId({
    uploadMetadataId: link.uploadMetadataId,
    tableName: link.tableName,
    columnName: link.categoryColumnName,
  });
}
