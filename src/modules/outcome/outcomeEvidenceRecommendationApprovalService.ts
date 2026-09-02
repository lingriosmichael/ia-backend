import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type {
  EpistemicRole,
  PreparedDatasetColumn,
} from "../../shared/contracts.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "../interpretation/activityAnalysisV2ToolTypes.js";
import {
  computePairedCategoricalShiftMeasurement,
  computePairedDeltaMeasurement,
  PairedMeasurementNoUsableResultError,
} from "../projectImpactStory/projectImpactStoryImpactCatalog.js";
import {
  assertPairedDeltaApprovalIsSafe,
  buildPairedCategoricalShiftProposalId,
  buildPairedDeltaProposalId,
  buildProposalIdFromLink,
  buildSingleDistributionProposalId,
  normalizeOutcomeEvidenceMatchValue,
  type OutcomeEvidencePairApprovalSafetyCheckTable,
} from "./outcomeEvidenceApprovalSafetyCheck.js";
import {
  loadOutcomeEvidenceActivityTables,
  type OutcomeEvidenceActivityTable,
  type OutcomeEvidenceCandidateCatalogDependencies,
} from "./outcomeEvidenceCandidateCatalogBuilder.js";
import type { OutcomeEvidenceRecommendation } from "./outcomeEvidenceRecommendationService.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type {
  OutcomeEvidenceLinkMatchDiagnostics,
  OutcomeEvidenceLinkPersistenceRecord,
} from "./outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";

// A single small, fixed-cost tool-executor call — same sizing reasoning as
// projectImpactStoryImpactCatalog.ts's PAIRED_DELTA_MEASUREMENT_RUN_LIMITS
// (which computePairedDeltaMeasurement below already applies internally for
// the paired_delta path); this constant covers this file's own
// single_distribution group_count verification call.
const SINGLE_DISTRIBUTION_RESOLUTION_RUN_LIMITS = {
  maxToolCalls: 5,
  maxLlmIterations: 1,
  timeoutMs: 30_000,
  maxEvidenceItems: 200,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeJoinValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function findPayloadTable(
  payload: Record<string, unknown>,
  preparedTableName: string,
): Record<string, unknown> | null {
  const tables = readRecordArray(payload.tables);
  if (tables.length === 0) {
    return null;
  }

  const exactMatch =
    tables.find((table) => table.name === preparedTableName) ?? null;
  if (exactMatch) {
    return exactMatch;
  }

  return tables.length === 1 ? (tables[0] ?? null) : null;
}

function readTableRows(
  snapshotEvidence: Array<{
    uploadMetadataId: string;
    payload: Record<string, unknown>;
  }>,
  uploadMetadataId: string,
  tableName: string,
): Record<string, unknown>[] {
  const evidenceItem =
    snapshotEvidence.find(
      (item) => item.uploadMetadataId === uploadMetadataId,
    ) ?? null;
  if (!evidenceItem) {
    return [];
  }

  const payloadTable = findPayloadTable(evidenceItem.payload, tableName);
  return payloadTable ? readRecordArray(payloadTable.rows) : [];
}

interface MatchKeyColumnStats {
  nonNullCount: number;
  distinctCount: number;
  hasDuplicates: boolean;
}

function computeMatchKeyColumnStats(
  rows: Record<string, unknown>[],
  columnName: string,
): MatchKeyColumnStats {
  const distinctValues = new Set<string>();
  let nonNullCount = 0;

  for (const row of rows) {
    const value = normalizeJoinValue(row[columnName]);
    if (value === null) {
      continue;
    }
    nonNullCount += 1;
    distinctValues.add(value);
  }

  return {
    nonNullCount,
    distinctCount: distinctValues.size,
    hasDuplicates: nonNullCount > distinctValues.size,
  };
}

// Shared shape both computePairedDeltaMeasurement and
// computePairedCategoricalShiftMeasurement's pair argument satisfy — lets
// selectBestMatchKeyOrThrow/measurePairedMeasurementOrThrow below stay
// generic over which of the two is actually being resolved, rather than
// duplicating the same candidate-key scoring loop per shape.
interface PairedMeasurementCandidatePair {
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

interface PairedMatchKeyEvaluation<TMeasurement extends { nMatched: number }> {
  matchKey: string;
  beforeStats: MatchKeyColumnStats;
  afterStats: MatchKeyColumnStats;
  measurement: TMeasurement;
  matchedRatio: number;
}

function findActivityTable(
  tables: OutcomeEvidenceActivityTable[],
  uploadMetadataId: string,
  tableName: string,
): OutcomeEvidenceActivityTable | undefined {
  return tables.find(
    (table) =>
      table.uploadMetadataId === uploadMetadataId &&
      table.tableName === tableName,
  );
}

function requireResolvedTable(
  tables: OutcomeEvidenceActivityTable[],
  reference: {
    uploadMetadataId: string;
    tableName: string;
    columnName: string;
  },
): OutcomeEvidenceActivityTable {
  const table = findActivityTable(
    tables,
    reference.uploadMetadataId,
    reference.tableName,
  );
  if (!table) {
    throw new AppError(
      "This evidence table is no longer available for this activity — it may have been re-uploaded or removed since the recommendation was generated.",
      404,
      "outcome_evidence_recommendation_table_not_found",
    );
  }
  if (!table.columns.some((column) => column.name === reference.columnName)) {
    throw new AppError(
      "This evidence column is no longer available on this table — it may have changed since the recommendation was generated.",
      404,
      "outcome_evidence_recommendation_column_not_found",
    );
  }
  return table;
}

function toSafetyCheckTable(
  table: OutcomeEvidenceActivityTable,
): OutcomeEvidencePairApprovalSafetyCheckTable {
  return {
    cohortTag: table.cohortTag,
    datasetRole: table.datasetRole,
  };
}

function findPreparedColumn(
  table: OutcomeEvidenceActivityTable,
  columnName: string,
): PreparedDatasetColumn | null {
  return table.columns.find((column) => column.name === columnName) ?? null;
}

function isFixedDomainRole(
  role: EpistemicRole | null,
): role is Extract<EpistemicRole, "categorical" | "flag"> {
  return role === "categorical" || role === "flag";
}

function isPairedDeltaNumericCompatibleColumn(
  column: PreparedDatasetColumn | null,
): boolean {
  return Boolean(
    column &&
    (column.inferredType === "numeric" ||
      column.epistemicRole === "validated_scale"),
  );
}

function normalizeObservedDomainValues(
  rows: Record<string, unknown>[],
  columnName: string,
): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row[columnName])
        .filter(
          (value): value is string | number | boolean =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean",
        )
        .map((value) => normalizeOutcomeEvidenceMatchValue(String(value)))
        .filter((value) => value.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Approval → persistence for the new joint pairing+outcome recommendation
 * flow (OUTCOME_EVIDENCE_MERGE_PLAN.md §4.4). A human has reviewed one
 * OutcomeEvidenceRecommendation (built by OutcomeEvidenceRecommendationService)
 * and chosen to confirm it; this service is what turns that confirmation
 * into a real, persisted OutcomeEvidenceLink — the same model/collection
 * the old outcome-evidence-pairing flow already writes to (§6: kept
 * unchanged).
 *
 * Never trusts the recommendation's cached column references at face
 * value: every column is re-resolved against current evidence, the same
 * deterministic safety checks the old candidate matcher used to run at
 * *proposal* time now run here at *approval* time instead (§4.4 step 2),
 * and the actual join/group tool execution is attempted before anything is
 * persisted, so a broken pairing surfaces as a clear error at confirm time
 * rather than silently producing an unresolvable link.
 */
export class OutcomeEvidenceRecommendationApprovalService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly candidateCatalogDependencies: OutcomeEvidenceCandidateCatalogDependencies,
    private readonly currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
    private readonly activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
    private readonly outcomeEvidenceLinkRepository: OutcomeEvidenceLinkRepository,
    private readonly projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
  ) {}

  // The approval-time equivalent of the check
  // OutcomeEvidenceRecommendationService.resolveRecommendation already
  // applies to every LLM-produced paired_delta (§4.3 grounding: "a
  // paired_delta recommendation's two columns must be different"). That
  // check never runs for a manually submitted pairing, since manual
  // submissions skip the LLM path entirely and post straight to this
  // service — which is explicitly the trust boundary for this flow (see
  // this class's own doc comment), so it needs its own copy of the check
  // rather than relying on the LLM path having already run it.
  private assertBeforeAfterAreDifferentColumns(
    before: { uploadMetadataId: string; tableName: string; columnName: string },
    after: { uploadMetadataId: string; tableName: string; columnName: string },
  ): void {
    const sameColumn =
      before.uploadMetadataId === after.uploadMetadataId &&
      before.tableName === after.tableName &&
      normalizeOutcomeEvidenceMatchValue(before.columnName) ===
        normalizeOutcomeEvidenceMatchValue(after.columnName);
    if (sameColumn) {
      throw new AppError(
        "The before and after columns must be different — a column cannot be paired with itself.",
        400,
        "outcome_evidence_recommendation_before_after_identical",
      );
    }
  }

  private assertPairedDeltaColumnsAreNumericCompatible(
    beforeTable: OutcomeEvidenceActivityTable,
    afterTable: OutcomeEvidenceActivityTable,
    before: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
    after: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
  ): void {
    const beforeColumn = findPreparedColumn(beforeTable, before.columnName);
    const afterColumn = findPreparedColumn(afterTable, after.columnName);
    if (
      isPairedDeltaNumericCompatibleColumn(beforeColumn) &&
      isPairedDeltaNumericCompatibleColumn(afterColumn)
    ) {
      return;
    }

    throw new AppError(
      "This before/after confirmation only supports numeric measures. Use a paired categorical shift recommendation for category-based evidence instead.",
      409,
      "outcome_evidence_recommendation_paired_delta_requires_numeric_columns",
    );
  }

  async approveRecommendation(
    userId: string,
    projectId: string,
    activityId: string,
    recommendation: OutcomeEvidenceRecommendation,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    if (!recommendation.outcomeId) {
      throw new AppError(
        "An outcomeId is required to approve a recommendation.",
        400,
        "outcome_evidence_recommendation_outcome_id_required",
      );
    }

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    if (!activity || activity.projectId !== project.id) {
      throw new AppError(
        "This activity was not found for this project.",
        404,
        "activity_not_found",
      );
    }

    const outcomeStatement =
      await this.projectOutcomeStatementRepository.findById(
        recommendation.outcomeId,
        databaseSession,
      );
    if (!outcomeStatement || outcomeStatement.projectId !== project.id) {
      throw new AppError(
        "This outcome statement was not found for this project.",
        404,
        "project_outcome_statement_not_found",
      );
    }

    const proposalId =
      recommendation.shape === "paired_delta"
        ? buildPairedDeltaProposalId(
            recommendation.before,
            recommendation.after,
          )
        : recommendation.shape === "paired_categorical_shift"
          ? buildPairedCategoricalShiftProposalId(
              recommendation.before,
              recommendation.after,
            )
          : buildSingleDistributionProposalId(recommendation.column);
    await this.assertNotAlreadyConfirmed(project.id, proposalId);

    const tables = await loadOutcomeEvidenceActivityTables(
      this.candidateCatalogDependencies,
      activityId,
    );

    const confirmedAt = new Date();
    if (recommendation.shape === "paired_delta") {
      this.assertBeforeAfterAreDifferentColumns(
        recommendation.before,
        recommendation.after,
      );

      const beforeTable = requireResolvedTable(tables, recommendation.before);
      const afterTable = requireResolvedTable(tables, recommendation.after);

      this.assertPairedDeltaColumnsAreNumericCompatible(
        beforeTable,
        afterTable,
        recommendation.before,
        recommendation.after,
      );
      assertPairedDeltaApprovalIsSafe(
        toSafetyCheckTable(beforeTable),
        toSafetyCheckTable(afterTable),
      );

      const matchSelection = await this.selectBestMatchKeyOrThrow(
        activityId,
        beforeTable,
        afterTable,
        recommendation.before,
        recommendation.after,
        (pair) =>
          this.measurePairedMeasurementOrThrow(
            computePairedDeltaMeasurement,
            pair,
          ),
      );

      return this.outcomeEvidenceLinkRepository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          outcomeId: recommendation.outcomeId,
          proposalId,
          shape: "paired_delta",
          activityIdBefore: activityId,
          activityIdAfter: activityId,
          beforeUploadMetadataId: recommendation.before.uploadMetadataId,
          beforeTableName: recommendation.before.tableName,
          beforeColumnName: recommendation.before.columnName,
          afterUploadMetadataId: recommendation.after.uploadMetadataId,
          afterTableName: recommendation.after.tableName,
          afterColumnName: recommendation.after.columnName,
          matchKey: matchSelection.matchKey,
          matchDiagnostics: matchSelection.matchDiagnostics,
          // There is no more human-declared instrument label to carry here
          // (pairing_group_key is removed — see OUTCOME_EVIDENCE_MERGE_PLAN.md
          // §5): the before column's own name stands in for it, matching
          // how projectImpactStoryImpactCatalog.ts's buildPairLabelDe
          // already humanizes this field for display regardless of where
          // it came from.
          pairingGroupKey: recommendation.before.columnName,
          confirmedById: userId,
          confirmedAt: confirmedAt.toISOString(),
        },
        databaseSession,
      );
    }

    if (recommendation.shape === "paired_categorical_shift") {
      this.assertBeforeAfterAreDifferentColumns(
        recommendation.before,
        recommendation.after,
      );

      const beforeTable = requireResolvedTable(tables, recommendation.before);
      const afterTable = requireResolvedTable(tables, recommendation.after);

      assertPairedDeltaApprovalIsSafe(
        toSafetyCheckTable(beforeTable),
        toSafetyCheckTable(afterTable),
      );

      const snapshot =
        await this.currentActivityEvidenceLoader.load(activityId);
      const beforeRows = readTableRows(
        snapshot.evidence,
        recommendation.before.uploadMetadataId,
        recommendation.before.tableName,
      );
      const afterRows = readTableRows(
        snapshot.evidence,
        recommendation.after.uploadMetadataId,
        recommendation.after.tableName,
      );
      const compatibilityCheck = this.assertPairedCategoricalShiftCompatibility(
        beforeTable,
        afterTable,
        recommendation.before,
        recommendation.after,
        beforeRows,
        afterRows,
      );
      const matchSelection = await this.selectBestMatchKeyOrThrow(
        activityId,
        beforeTable,
        afterTable,
        recommendation.before,
        recommendation.after,
        (pair) =>
          this.measurePairedMeasurementOrThrow(
            computePairedCategoricalShiftMeasurement,
            pair,
          ),
      );

      return this.outcomeEvidenceLinkRepository.create(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          outcomeId: recommendation.outcomeId,
          proposalId,
          shape: "paired_categorical_shift",
          activityIdBefore: activityId,
          activityIdAfter: activityId,
          beforeUploadMetadataId: recommendation.before.uploadMetadataId,
          beforeTableName: recommendation.before.tableName,
          beforeColumnName: recommendation.before.columnName,
          afterUploadMetadataId: recommendation.after.uploadMetadataId,
          afterTableName: recommendation.after.tableName,
          afterColumnName: recommendation.after.columnName,
          matchKey: matchSelection.matchKey,
          matchDiagnostics: {
            ...matchSelection.matchDiagnostics,
            compatibilityCheck,
          },
          pairLabelColumnName: recommendation.before.columnName,
          confirmedById: userId,
          confirmedAt: confirmedAt.toISOString(),
        },
        databaseSession,
      );
    }

    requireResolvedTable(tables, recommendation.column);
    await this.resolveSingleDistributionOrThrow(
      activityId,
      recommendation.column.uploadMetadataId,
      recommendation.column.tableName,
      recommendation.column.columnName,
    );

    return this.outcomeEvidenceLinkRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        outcomeId: recommendation.outcomeId,
        proposalId,
        shape: "single_distribution",
        activityId,
        uploadMetadataId: recommendation.column.uploadMetadataId,
        tableName: recommendation.column.tableName,
        categoryColumnName: recommendation.column.columnName,
        confirmedById: userId,
        confirmedAt: confirmedAt.toISOString(),
      },
      databaseSession,
    );
  }

  // Restores a capability the old outcomeEvidencePairingService.ts had
  // (removeConfirmedLink) that OUTCOME_EVIDENCE_MERGE_PLAN.md's removal
  // list didn't carry forward to the new flow — un-confirming a wrongly
  // assigned OutcomeEvidenceLink is generic, still-needed functionality,
  // independent of which review flow produced the link.
  async removeConfirmedLink(
    userId: string,
    projectId: string,
    linkId: string,
  ): Promise<void> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const existing = await this.outcomeEvidenceLinkRepository.findById(
      linkId,
      databaseSession,
    );
    if (!existing || existing.projectId !== project.id) {
      throw new AppError(
        "This confirmed evidence link was not found for this project.",
        404,
        "outcome_evidence_link_not_found",
      );
    }

    await this.outcomeEvidenceLinkRepository.deleteById(
      linkId,
      databaseSession,
    );
  }

  // Bulk counterpart to removeConfirmedLink above, for the frontend's
  // "remove all" action on the confirmed-links summary. Reuses
  // deleteByActivityId, the same repository method
  // processingResourceCleanupService.ts's cascade-delete already relies on.
  async removeAllConfirmedLinksForActivity(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<number> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    if (!activity || activity.projectId !== project.id) {
      throw new AppError(
        "This activity was not found for this project.",
        404,
        "activity_not_found",
      );
    }

    return this.outcomeEvidenceLinkRepository.deleteByActivityId(
      activityId,
      databaseSession,
    );
  }

  // The fast-path check: catches the common non-concurrent case before
  // spending a resolution call on the join/group operation. It is not
  // the actual duplicate-prevention guarantee — that's the unique
  // { projectId, proposalId } index create() relies on (see the
  // isMongoDuplicateKeyError handling in outcomeEvidenceLinkMongoRepository.ts),
  // which also catches the concurrent case this read-then-write check cannot.
  private async assertNotAlreadyConfirmed(
    projectId: string,
    proposalId: string,
  ): Promise<void> {
    const existingLinks =
      await this.outcomeEvidenceLinkRepository.listByProjectId(
        projectId,
        databaseSession,
      );
    const alreadyConfirmed = existingLinks.some(
      (link) => buildProposalIdFromLink(link) === proposalId,
    );
    if (alreadyConfirmed) {
      throw new AppError(
        "This evidence option has already been confirmed.",
        409,
        "outcome_evidence_link_already_confirmed",
      );
    }
  }

  // Shared by both the paired_delta and paired_categorical_shift approval
  // paths (see the two call sites below) — the candidate-key scoring and
  // tie-break logic is identical for both shapes; only which measurement
  // function actually resolves a candidate key differs, so that part is
  // injected via `measure` rather than duplicated per shape.
  private async selectBestMatchKeyOrThrow<
    TMeasurement extends { nMatched: number },
  >(
    activityId: string,
    beforeTable: OutcomeEvidenceActivityTable,
    afterTable: OutcomeEvidenceActivityTable,
    before: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
    after: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
    measure: (pair: PairedMeasurementCandidatePair) => Promise<TMeasurement>,
  ): Promise<{
    matchKey: string;
    matchDiagnostics: OutcomeEvidenceLinkMatchDiagnostics;
  }> {
    const snapshot = await this.currentActivityEvidenceLoader.load(activityId);
    const beforeRows = readTableRows(
      snapshot.evidence,
      before.uploadMetadataId,
      before.tableName,
    );
    const afterRows = readTableRows(
      snapshot.evidence,
      after.uploadMetadataId,
      after.tableName,
    );

    const sharedColumnNames = beforeTable.columns
      .map((column) => column.name)
      .filter((columnName) =>
        afterTable.columns.some((candidate) => candidate.name === columnName),
      );

    const evaluations: PairedMatchKeyEvaluation<TMeasurement>[] = [];
    for (const matchKey of sharedColumnNames) {
      const beforeStats = computeMatchKeyColumnStats(beforeRows, matchKey);
      const afterStats = computeMatchKeyColumnStats(afterRows, matchKey);
      if (
        beforeStats.nonNullCount === 0 ||
        afterStats.nonNullCount === 0 ||
        beforeStats.hasDuplicates ||
        afterStats.hasDuplicates
      ) {
        continue;
      }

      // A candidate key producing zero real matches is expected and not
      // fatal — try the next shared column instead. Both measurement
      // functions throw (via measurePairedMeasurementOrThrow) rather than
      // returning a zero-but-valid result for an empty join, so that has
      // to be caught per candidate here, not just handled via
      // `measurement.nMatched === 0` below (which only fires for a result
      // that came back genuinely zero-but-well-formed, not for a thrown
      // resolution failure).
      let measurement: TMeasurement;
      try {
        measurement = await measure({
          activityIdBefore: activityId,
          activityIdAfter: activityId,
          beforeUploadMetadataId: before.uploadMetadataId,
          beforeTableName: before.tableName,
          beforeColumnName: before.columnName,
          afterUploadMetadataId: after.uploadMetadataId,
          afterTableName: after.tableName,
          afterColumnName: after.columnName,
          matchKey,
        });
      } catch (error) {
        if (error instanceof PairedMeasurementNoUsableResultError) {
          continue;
        }
        throw error;
      }

      if (measurement.nMatched === 0) {
        continue;
      }

      evaluations.push({
        matchKey,
        beforeStats,
        afterStats,
        measurement,
        matchedRatio:
          measurement.nMatched /
          Math.min(beforeStats.nonNullCount, afterStats.nonNullCount),
      });
    }

    if (evaluations.length === 0) {
      throw new AppError(
        "No shared join key on the before and after tables produced any matched respondents. Check that both tables share a real participant identifier.",
        409,
        "outcome_evidence_recommendation_no_matched_pairs",
      );
    }

    evaluations.sort((left, right) => {
      if (right.measurement.nMatched !== left.measurement.nMatched) {
        return right.measurement.nMatched - left.measurement.nMatched;
      }
      if (right.matchedRatio !== left.matchedRatio) {
        return right.matchedRatio - left.matchedRatio;
      }
      return left.matchKey.localeCompare(right.matchKey);
    });

    const winner = evaluations[0] as PairedMatchKeyEvaluation<TMeasurement>;
    const runnerUp = evaluations[1] ?? null;
    if (
      runnerUp &&
      runnerUp.measurement.nMatched === winner.measurement.nMatched &&
      runnerUp.matchedRatio === winner.matchedRatio
    ) {
      throw new AppError(
        `Multiple shared join keys look equally valid for this pairing (${winner.matchKey}, ${runnerUp.matchKey}). Pick a clearer identifier before confirming this recommendation.`,
        409,
        "outcome_evidence_recommendation_ambiguous_match_key",
      );
    }

    return {
      matchKey: winner.matchKey,
      matchDiagnostics: {
        matchedCount: winner.measurement.nMatched,
        baselineCount: winner.beforeStats.nonNullCount,
        comparisonCount: winner.afterStats.nonNullCount,
        matchedRatio: winner.matchedRatio,
        candidateKeysConsidered: evaluations.map(
          (evaluation) => evaluation.matchKey,
        ),
      },
    };
  }

  // Shared error-wrapping around either compute function — a no-usable-
  // result error means this specific candidate key/link just doesn't
  // join, and is rethrown as-is so selectBestMatchKeyOrThrow can tell "try
  // the next candidate" apart from a genuine failure; any other error is
  // wrapped into a consistent 502 for the caller.
  private async measurePairedMeasurementOrThrow<TMeasurement>(
    computeMeasurement: (
      currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
      activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
      pair: PairedMeasurementCandidatePair,
    ) => Promise<TMeasurement>,
    pair: PairedMeasurementCandidatePair,
  ): Promise<TMeasurement> {
    try {
      return await computeMeasurement(
        this.currentActivityEvidenceLoader,
        this.activityAnalysisV2ToolExecutor,
        pair,
      );
    } catch (error) {
      if (error instanceof PairedMeasurementNoUsableResultError) {
        throw error;
      }
      throw new AppError(
        "This pairing could not be resolved against the current evidence — it may no longer be joinable.",
        502,
        "outcome_evidence_recommendation_resolution_failed",
        error instanceof Error ? { message: error.message } : undefined,
      );
    }
  }

  private assertPairedCategoricalShiftCompatibility(
    beforeTable: OutcomeEvidenceActivityTable,
    afterTable: OutcomeEvidenceActivityTable,
    before: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
    after: {
      uploadMetadataId: string;
      tableName: string;
      columnName: string;
    },
    beforeRows: Record<string, unknown>[],
    afterRows: Record<string, unknown>[],
  ): NonNullable<OutcomeEvidenceLinkMatchDiagnostics["compatibilityCheck"]> {
    const beforeColumn = findPreparedColumn(beforeTable, before.columnName);
    const afterColumn = findPreparedColumn(afterTable, after.columnName);
    if (!beforeColumn || !afterColumn) {
      throw new AppError(
        "This evidence column is no longer available on this table — it may have changed since the recommendation was generated.",
        404,
        "outcome_evidence_recommendation_column_not_found",
      );
    }

    const beforeRole = beforeColumn.epistemicRole ?? null;
    const afterRole = afterColumn.epistemicRole ?? null;
    if (beforeRole === "subjective_code" || afterRole === "subjective_code") {
      if (beforeRole !== "subjective_code" || afterRole !== "subjective_code") {
        throw new AppError(
          "A coded qualitative column can only be paired with another coded qualitative column that reuses the same approved codebook provenance.",
          409,
          "outcome_evidence_recommendation_incompatible_categorical_roles",
        );
      }

      // Accepted in either direction, not just "endline declares baseline
      // as source": review order doesn't always match wave chronology (a
      // baseline upload reviewed after its endline counterpart is already
      // approved would legitimately produce the reverse pointer). Either
      // direction proves the same fact — the two findings share one
      // codebook — so both satisfy this check's actual purpose.
      const beforeProvenance =
        beforeTable.subjectiveCodeProvenanceByColumnName[before.columnName] ??
        null;
      const afterProvenance =
        afterTable.subjectiveCodeProvenanceByColumnName[after.columnName] ??
        null;
      const afterPointsToBefore =
        afterProvenance?.sourceCodebookFrom?.uploadMetadataId ===
          before.uploadMetadataId &&
        afterProvenance.sourceCodebookFrom.findingKey ===
          (beforeProvenance?.findingKey ?? null);
      const beforePointsToAfter =
        beforeProvenance?.sourceCodebookFrom?.uploadMetadataId ===
          after.uploadMetadataId &&
        beforeProvenance.sourceCodebookFrom.findingKey ===
          afterProvenance?.findingKey;
      if (
        !beforeProvenance ||
        !afterProvenance ||
        (!afterPointsToBefore && !beforePointsToAfter)
      ) {
        throw new AppError(
          "This coded qualitative pairing cannot be confirmed because neither column declares reuse of the other column's approved codebook.",
          409,
          "outcome_evidence_recommendation_subjective_code_provenance_required",
        );
      }

      return {
        strategy: "shared_codebook_provenance",
        beforeEpistemicRole: beforeRole,
        afterEpistemicRole: afterRole,
        beforeSourceCodebookUploadMetadataId:
          beforeProvenance.sourceCodebookFrom?.uploadMetadataId ?? null,
        beforeSourceCodebookFindingKey:
          beforeProvenance.sourceCodebookFrom?.findingKey ?? null,
        afterSourceCodebookUploadMetadataId:
          afterProvenance.sourceCodebookFrom?.uploadMetadataId ?? null,
        afterSourceCodebookFindingKey:
          afterProvenance.sourceCodebookFrom?.findingKey ?? null,
      };
    }

    if (!isFixedDomainRole(beforeRole) || !isFixedDomainRole(afterRole)) {
      throw new AppError(
        "This categorical-shift pairing requires categorical, flag, or approved subjective-code columns.",
        409,
        "outcome_evidence_recommendation_incompatible_categorical_roles",
      );
    }

    const beforeNormalizedValues = normalizeObservedDomainValues(
      beforeRows,
      before.columnName,
    );
    const afterNormalizedValues = normalizeObservedDomainValues(
      afterRows,
      after.columnName,
    );
    const hasSameDomain =
      beforeNormalizedValues.length > 0 &&
      beforeNormalizedValues.length === afterNormalizedValues.length &&
      beforeNormalizedValues.every(
        (value, index) => value === afterNormalizedValues[index],
      );
    if (!hasSameDomain) {
      throw new AppError(
        "These before and after columns do not share the same observed answer domain, so they cannot be confirmed as one fixed-domain categorical shift.",
        409,
        "outcome_evidence_recommendation_categorical_domain_mismatch",
      );
    }

    return {
      strategy: "observed_value_domain",
      beforeEpistemicRole: beforeRole,
      afterEpistemicRole: afterRole,
      beforeNormalizedValues,
      afterNormalizedValues,
    };
  }

  private async resolveSingleDistributionOrThrow(
    activityId: string,
    uploadMetadataId: string,
    tableName: string,
    columnName: string,
  ): Promise<void> {
    try {
      const snapshot =
        await this.currentActivityEvidenceLoader.load(activityId);
      const requests: ActivityAnalysisV2ToolRequest[] = [
        {
          toolName: "group_count",
          arguments: { uploadMetadataId, tableName, columnName },
        },
      ];
      await this.activityAnalysisV2ToolExecutor.execute(
        requests,
        snapshot,
        SINGLE_DISTRIBUTION_RESOLUTION_RUN_LIMITS,
        Date.now(),
      );
    } catch (error) {
      throw new AppError(
        "This column could not be resolved against the current evidence.",
        502,
        "outcome_evidence_recommendation_resolution_failed",
        error instanceof Error ? { message: error.message } : undefined,
      );
    }
  }
}
