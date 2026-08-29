import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { ActivityAnalysisV2ToolRequest } from "../interpretation/activityAnalysisV2ToolTypes.js";
import { computePairedDeltaMeasurement } from "../projectImpactStory/projectImpactStoryImpactCatalog.js";
import {
  assertPairedDeltaApprovalIsSafe,
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

interface PairedDeltaMatchKeyEvaluation {
  matchKey: string;
  beforeStats: MatchKeyColumnStats;
  afterStats: MatchKeyColumnStats;
  measurement: Awaited<ReturnType<typeof computePairedDeltaMeasurement>>;
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
  };
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
  // "remove all" action on the confirmed-links summary — clearing every
  // confirmed link for the activity is what lets the recommend section
  // (hidden outright once any link is confirmed, see
  // outcomeEvidenceRecommendationPanel.tsx) reappear. Reuses
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

  private async selectBestMatchKeyOrThrow(
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

    const evaluations: PairedDeltaMatchKeyEvaluation[] = [];
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

      const measurement = await this.measurePairedDeltaOrThrow({
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

    const winner = evaluations[0] as PairedDeltaMatchKeyEvaluation;
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

  private async measurePairedDeltaOrThrow(pair: {
    activityIdBefore: string;
    activityIdAfter: string;
    beforeUploadMetadataId: string;
    beforeTableName: string;
    beforeColumnName: string;
    afterUploadMetadataId: string;
    afterTableName: string;
    afterColumnName: string;
    matchKey: string;
  }): Promise<Awaited<ReturnType<typeof computePairedDeltaMeasurement>>> {
    try {
      return await computePairedDeltaMeasurement(
        this.currentActivityEvidenceLoader,
        this.activityAnalysisV2ToolExecutor,
        pair,
      );
    } catch (error) {
      throw new AppError(
        "This pairing could not be resolved against the current evidence — it may no longer be joinable.",
        502,
        "outcome_evidence_recommendation_resolution_failed",
        error instanceof Error ? { message: error.message } : undefined,
      );
    }
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
