import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type {
  ActivitySystemType,
  OutcomeEvidenceLink,
  OutcomeEvidencePairingActivityDiagnostic,
  OutcomeEvidencePairingActivityUploadState,
  OutcomeEvidencePairingDiagnosticReason,
  OutcomeEvidencePairingDiagnostics,
  OutcomeEvidencePairingDiagnosticsTrigger,
  OutcomeEvidencePairingProposal,
  OutcomeEvidencePairingProposalDecision,
  OutcomeEvidencePairingResultRecord,
  OutcomeEvidencePairingSuggestedOutcome,
  ProjectOutcomeStatement,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationService } from "../interpretation/interpretationService.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { loadProjectEvidenceTablesForOutcomePairing } from "./outcomeEvidencePairingEvidenceLoader.js";
import {
  buildPairedDeltaProposalId,
  buildSingleDistributionProposalId,
  canSafelyPairEvidenceTables,
  computeOutcomeEvidencePairingCandidates,
  hasCompatibleScaleBounds,
  normalizeColumnName,
} from "./outcomeEvidencePairingCandidateMatcher.js";
import type { OutcomeEvidencePairingResultRepository } from "./outcomeEvidencePairingResultRepository.js";
import type { OutcomeEvidencePairingResultPersistenceRecord } from "./outcomeEvidencePairingResultPersistence.js";
import type { OutcomeEvidenceLinkRepository } from "./outcomeEvidenceLinkRepository.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "./outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import type { OutcomeEvidencePairingSuggestionService } from "./outcomeEvidencePairingSuggestionService.js";
import type { OutcomeEvidencePairingEvidenceTable } from "./outcomeEvidencePairingEvidenceLoader.js";

function isReadyForPairingPreparation(
  preparation:
    | Awaited<
        ReturnType<
          DatasetPreparationRepository["findByInterpretationResultIds"]
        >
      >[number]
    | undefined,
): preparation is NonNullable<typeof preparation> & {
  preparedDataset: NonNullable<
    NonNullable<typeof preparation>["preparedDataset"]
  >;
} {
  return (
    preparation !== undefined &&
    preparation.preparedDataset !== null &&
    preparation.preparedDataset.isReadyForDeterministicAnalysis &&
    (preparation.status === "ready_for_analysis" ||
      preparation.status === "analysis_completed")
  );
}

// Exported for direct unit testing, same reasoning as
// outcomeEvidencePairingCandidateMatcher.ts's exported pure helpers — this
// is deterministic reason-code derivation with no repository dependency,
// so it doesn't need the full mocked-service setup to verify.
export function listDiagnosticReasons(
  trigger: OutcomeEvidencePairingDiagnosticsTrigger,
  candidateCount: number,
  tables: OutcomeEvidencePairingEvidenceTable[],
  activityDiagnostics: OutcomeEvidencePairingActivityDiagnostic[],
): OutcomeEvidencePairingDiagnosticReason[] {
  const reasons: OutcomeEvidencePairingDiagnosticReason[] = [];
  const addReason = (code: OutcomeEvidencePairingDiagnosticReason["code"]) => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push({ code });
    }
  };

  if (
    trigger === "refresh" &&
    activityDiagnostics.some((activity) => activity.status === "jobs_started")
  ) {
    addReason("jobs_started");
  }

  if (candidateCount > 0) {
    return reasons;
  }

  if (tables.length === 0) {
    addReason("no_ready_tables");
    return reasons;
  }

  const baselineTables = tables.filter(
    (table) => table.activitySystemType === "baseline",
  );
  const impactTables = tables.filter(
    (table) => table.activitySystemType === "impact_measurement",
  );
  const hasSharedIdentifierAcrossSystemActivities = baselineTables.some(
    (baselineTable) =>
      impactTables.some((impactTable) =>
        canSafelyPairEvidenceTables(baselineTable, impactTable),
      ),
  );
  const hasValidatedScaleColumns = tables.some((table) =>
    table.columns.some((column) => column.epistemicRole === "validated_scale"),
  );
  const hasCategoricalColumns = tables.some((table) =>
    table.columns.some((column) => column.epistemicRole === "categorical"),
  );
  const hasDuplicateIdentifierTable = tables.some(
    (table) => table.hasDuplicateIdentifierValues,
  );

  // Matching is now purely declared (pairing_group_key/pairing_group_role),
  // not name/stem-based — so "why is nothing showing up" splits into two
  // distinct causes: nobody has answered the question yet at all (the
  // common case right after this ships), vs. answers exist but didn't
  // resolve into a candidate (bounds mismatch, orphan role, etc.).
  const declaredScaleColumns = tables.flatMap((table) =>
    table.columns
      .filter(
        (column) =>
          column.epistemicRole === "validated_scale" &&
          column.pairingGroupKey &&
          column.pairingGroupRole,
      )
      .map((column) => ({ table, column })),
  );
  const hasDeclaredPairingGroups = declaredScaleColumns.length > 0;
  const hasScaleBoundsMismatch = declaredScaleColumns.some(
    ({ column: beforeColumn }) => {
      if (beforeColumn.pairingGroupRole !== "before") {
        return false;
      }
      const normalizedKey = normalizeColumnName(
        beforeColumn.pairingGroupKey ?? "",
      );
      return declaredScaleColumns.some(
        ({ column: afterColumn }) =>
          afterColumn.pairingGroupRole === "after" &&
          normalizeColumnName(afterColumn.pairingGroupKey ?? "") ===
            normalizedKey &&
          !hasCompatibleScaleBounds(beforeColumn, afterColumn),
      );
    },
  );

  if (!hasSharedIdentifierAcrossSystemActivities) {
    addReason("no_shared_identifier");
  }
  if (hasValidatedScaleColumns && !hasDeclaredPairingGroups) {
    addReason("no_declared_pairing_groups");
  } else if (hasDeclaredPairingGroups) {
    addReason("no_matching_scale_columns");
  }
  if (!hasCategoricalColumns) {
    addReason("no_categorical_columns");
  }
  if (hasDuplicateIdentifierTable) {
    addReason("duplicate_identifier_values");
  }
  if (hasScaleBoundsMismatch) {
    addReason("scale_bounds_mismatch");
  }

  return reasons;
}

interface ProjectEvidenceSnapshot {
  activities: Array<{
    id: string;
    name: string;
    systemType: ActivitySystemType | null;
  }>;
  uploadCountByActivityId: Map<string, number>;
  interpretedUploadCountByActivityId: Map<string, number>;
  readyTableCountByActivityId: Map<string, number>;
  uploadStatesByActivityId: Map<
    string,
    OutcomeEvidencePairingActivityUploadState[]
  >;
  tables: OutcomeEvidencePairingEvidenceTable[];
}

function isOutcomeEvidenceSystemActivity(
  systemType: ActivitySystemType | null,
): boolean {
  return systemType === "baseline" || systemType === "impact_measurement";
}

function buildEligibleEvidenceOptions(
  candidates: OutcomeEvidencePairingProposal[],
  confirmedLinks: OutcomeEvidenceLinkPersistenceRecord[],
): OutcomeEvidencePairingProposal[] {
  const confirmedProposalIds = new Set(
    confirmedLinks.map((link) => buildProposalIdFromConfirmedLink(link)),
  );
  return candidates.filter(
    (candidate) => !confirmedProposalIds.has(candidate.proposalId),
  );
}

function mapOutcomeStatement(
  record: ProjectOutcomeStatementPersistenceRecord,
): ProjectOutcomeStatement {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    term: record.term,
    statement: record.statement,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapOutcomeEvidenceLink(
  record: OutcomeEvidenceLinkPersistenceRecord,
): OutcomeEvidenceLink {
  if (record.shape === "paired_delta") {
    return {
      linkId: record.linkId,
      outcomeId: record.outcomeId,
      shape: "paired_delta",
      activityIdBefore: record.activityIdBefore,
      activityIdAfter: record.activityIdAfter,
      beforeUploadMetadataId: record.beforeUploadMetadataId,
      beforeTableName: record.beforeTableName,
      beforeColumnName: record.beforeColumnName,
      afterUploadMetadataId: record.afterUploadMetadataId,
      afterTableName: record.afterTableName,
      afterColumnName: record.afterColumnName,
      matchKey: record.matchKey,
      pairingGroupKey: record.pairingGroupKey,
      confirmedById: record.confirmedById,
      confirmedAt: record.confirmedAt,
    };
  }

  return {
    linkId: record.linkId,
    outcomeId: record.outcomeId,
    shape: "single_distribution",
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    tableName: record.tableName,
    categoryColumnName: record.categoryColumnName,
    confirmedById: record.confirmedById,
    confirmedAt: record.confirmedAt,
  };
}

function buildProposalIdFromConfirmedLink(
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

  return buildSingleDistributionProposalId({
    uploadMetadataId: link.uploadMetadataId,
    tableName: link.tableName,
    columnName: link.categoryColumnName,
  });
}

export class OutcomeEvidencePairingService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly outcomeEvidencePairingResultRepository: OutcomeEvidencePairingResultRepository,
    private readonly outcomeEvidenceLinkRepository: OutcomeEvidenceLinkRepository,
    private readonly projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
    private readonly outcomeEvidencePairingSuggestionService: OutcomeEvidencePairingSuggestionService,
    private readonly interpretationService: InterpretationService,
  ) {}

  // Re-derives candidates from current evidence every time, keeping only
  // decisions whose proposalId still matches a currently-detected
  // candidate — mirrors EvidenceLinkageReconciliationService.reconcileForActivity's
  // reasoning: a proposalId is a deterministic hash of the columns
  // involved, so it naturally drops out on its own once evidence changes
  // enough that the candidate no longer exists.
  async proposeForProject(
    userId: string,
    projectId: string,
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidencePairingResultRecord> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const pairingResult = await this.reconcilePairingResult(
      project.id,
      project.organizationId,
      language,
    );
    const snapshot = await this.collectProjectEvidenceSnapshot(
      userId,
      project.id,
    );
    const allCandidates = computeOutcomeEvidencePairingCandidates(
      snapshot.tables,
    );
    const confirmedLinks =
      await this.outcomeEvidenceLinkRepository.listByProjectId(
        project.id,
        databaseSession,
      );
    return this.composeReviewRecord(
      project.id,
      pairingResult,
      this.buildDiagnostics(
        "propose",
        snapshot,
        pairingResult.proposals.length,
      ),
      buildEligibleEvidenceOptions(allCandidates, confirmedLinks),
    );
  }

  async refreshForProject(
    userId: string,
    projectId: string,
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidencePairingResultRecord> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const snapshot = await this.collectProjectEvidenceSnapshot(
      userId,
      project.id,
    );
    const refreshDiagnostics: OutcomeEvidencePairingActivityDiagnostic[] = [];

    for (const activity of snapshot.activities) {
      const uploadCount =
        snapshot.uploadCountByActivityId.get(activity.id) ?? 0;
      const interpretedUploadCount =
        snapshot.interpretedUploadCountByActivityId.get(activity.id) ?? 0;
      const readyTableCount =
        snapshot.readyTableCountByActivityId.get(activity.id) ?? 0;

      if (uploadCount === 0) {
        refreshDiagnostics.push({
          activityId: activity.id,
          activityName: activity.name,
          systemType: activity.systemType,
          uploadCount,
          interpretedUploadCount,
          readyTableCount,
          status: "no_uploads",
          startedCount: 0,
          skippedCount: 0,
          startedJobIds: [],
          uploadStates: [],
        });
        continue;
      }

      refreshDiagnostics.push({
        activityId: activity.id,
        activityName: activity.name,
        systemType: activity.systemType,
        uploadCount,
        interpretedUploadCount,
        readyTableCount,
        status:
          readyTableCount > 0 || interpretedUploadCount > 0
            ? "already_ready"
            : "blocked",
        startedCount: 0,
        skippedCount: uploadCount,
        startedJobIds: [],
        uploadStates: snapshot.uploadStatesByActivityId.get(activity.id) ?? [],
      });
    }

    const pairingResult = await this.reconcilePairingResult(
      project.id,
      project.organizationId,
      language,
    );
    const allCandidates = computeOutcomeEvidencePairingCandidates(
      snapshot.tables,
    );
    const confirmedLinks =
      await this.outcomeEvidenceLinkRepository.listByProjectId(
        project.id,
        databaseSession,
      );

    return this.composeReviewRecord(
      project.id,
      pairingResult,
      this.buildDiagnostics(
        "refresh",
        snapshot,
        pairingResult.proposals.length,
        refreshDiagnostics,
      ),
      buildEligibleEvidenceOptions(allCandidates, confirmedLinks),
    );
  }

  private async reconcilePairingResult(
    projectId: string,
    organizationId: string,
    language: "de" | "en",
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord> {
    const tables = await loadProjectEvidenceTablesForOutcomePairing(
      {
        activityRepository: this.activityRepository,
        uploadMetadataRepository: this.uploadMetadataRepository,
        interpretationResultRepository: this.interpretationResultRepository,
        datasetPreparationRepository: this.datasetPreparationRepository,
        privacySafeRepresentationRepository:
          this.privacySafeRepresentationRepository,
      },
      projectId,
    );
    const candidates = computeOutcomeEvidencePairingCandidates(tables);
    const currentCandidateIds = new Set(
      candidates.map((candidate) => candidate.proposalId),
    );

    const [existing, confirmedLinks, outcomeStatements] = await Promise.all([
      this.outcomeEvidencePairingResultRepository.findByProjectId(
        projectId,
        databaseSession,
      ),
      this.outcomeEvidenceLinkRepository.listByProjectId(
        projectId,
        databaseSession,
      ),
      this.projectOutcomeStatementRepository.listByProjectId(
        projectId,
        databaseSession,
      ),
    ]);
    const validOutcomeIds = new Set(
      outcomeStatements.map((outcomeStatement) => outcomeStatement.id),
    );
    const confirmedProposalIds = new Set(
      confirmedLinks.map((link) => buildProposalIdFromConfirmedLink(link)),
    );
    const proposalDecisions = (existing?.proposalDecisions ?? []).filter(
      (decision) =>
        currentCandidateIds.has(decision.proposalId) &&
        (decision.decision === "reject" ||
          confirmedProposalIds.has(decision.proposalId)),
    );
    const decidedProposalIds = new Set(
      proposalDecisions.map((decision) => decision.proposalId),
    );
    const pendingProposals = candidates.filter(
      (candidate) => !decidedProposalIds.has(candidate.proposalId),
    );

    const cachedSuggestionByProposalId = new Map(
      (existing?.proposals ?? []).map((proposal) => [
        proposal.proposalId,
        proposal.suggestedOutcome,
      ]),
    );
    const pendingProposalsWithCachedSuggestions = pendingProposals.map(
      (proposal) => ({
        ...proposal,
        suggestedOutcome:
          cachedSuggestionByProposalId.get(proposal.proposalId) ?? null,
      }),
    );
    const proposalsNeedingSuggestion =
      pendingProposalsWithCachedSuggestions.filter(
        (proposal) => proposal.suggestedOutcome === null,
      );

    let finalProposals = pendingProposalsWithCachedSuggestions;
    if (proposalsNeedingSuggestion.length > 0 && outcomeStatements.length > 0) {
      const activities = await this.activityRepository.listByProject(
        projectId,
        databaseSession,
      );
      const activityNameById = new Map(
        activities.map((activity) => [activity.id, activity.name]),
      );
      let suggestionByProposalId = new Map<
        string,
        OutcomeEvidencePairingSuggestedOutcome
      >();
      try {
        suggestionByProposalId =
          await this.outcomeEvidencePairingSuggestionService.suggestOutcomes({
            projectId,
            language,
            outcomeStatements,
            candidates: proposalsNeedingSuggestion,
            activityNameById,
          });
      } catch {
        // Swallowed intentionally — candidates simply stay
        // suggestedOutcome: null and are retried on the next propose call.
      }
      finalProposals = pendingProposalsWithCachedSuggestions.map((proposal) => {
        const suggestion = suggestionByProposalId.get(proposal.proposalId);
        if (!suggestion) {
          return proposal;
        }
        if (
          suggestion.outcomeId !== null &&
          !validOutcomeIds.has(suggestion.outcomeId)
        ) {
          return {
            ...proposal,
            suggestedOutcome: { ...suggestion, outcomeId: null },
          };
        }
        return { ...proposal, suggestedOutcome: suggestion };
      });
    }

    return this.outcomeEvidencePairingResultRepository.upsertByProjectId(
      {
        organizationId,
        projectId,
        status: finalProposals.length > 0 ? "needs_review" : "resolved",
        proposals: finalProposals,
        proposalDecisions,
      },
      databaseSession,
    );
  }

  private async composeReviewRecord(
    projectId: string,
    pairingResult: OutcomeEvidencePairingResultPersistenceRecord,
    diagnostics: OutcomeEvidencePairingDiagnostics,
    eligibleEvidenceOptions: OutcomeEvidencePairingProposal[],
  ): Promise<OutcomeEvidencePairingResultRecord> {
    const [outcomeStatements, confirmedLinks] = await Promise.all([
      this.projectOutcomeStatementRepository.listByProjectId(
        projectId,
        databaseSession,
      ),
      this.outcomeEvidenceLinkRepository.listByProjectId(
        projectId,
        databaseSession,
      ),
    ]);
    const validOutcomeIds = new Set(
      outcomeStatements.map((outcomeStatement) => outcomeStatement.id),
    );

    return {
      id: pairingResult.id,
      organizationId: pairingResult.organizationId,
      projectId: pairingResult.projectId,
      status: pairingResult.status,
      proposals: pairingResult.proposals,
      eligibleEvidenceOptions,
      proposalDecisions: pairingResult.proposalDecisions,
      outcomeSections: outcomeStatements.map((outcomeStatement) => ({
        outcomeStatement: mapOutcomeStatement(outcomeStatement),
        confirmedLinks: confirmedLinks
          .filter((link) => link.outcomeId === outcomeStatement.id)
          .map((link) => mapOutcomeEvidenceLink(link)),
        recommendedProposals: pairingResult.proposals.filter(
          (proposal) =>
            proposal.suggestedOutcome?.outcomeId === outcomeStatement.id,
        ),
      })),
      unassignedProposals: pairingResult.proposals.filter(
        (proposal) =>
          proposal.suggestedOutcome === null ||
          proposal.suggestedOutcome.outcomeId === null ||
          !validOutcomeIds.has(proposal.suggestedOutcome.outcomeId),
      ),
      diagnostics,
      createdAt: pairingResult.createdAt.toISOString(),
      updatedAt: pairingResult.updatedAt.toISOString(),
    };
  }

  private buildDiagnostics(
    trigger: OutcomeEvidencePairingDiagnosticsTrigger,
    snapshot: ProjectEvidenceSnapshot,
    candidateCount: number,
    refreshDiagnostics?: OutcomeEvidencePairingActivityDiagnostic[],
  ): OutcomeEvidencePairingDiagnostics {
    const activityDiagnostics =
      refreshDiagnostics ??
      snapshot.activities.map((activity) => ({
        activityId: activity.id,
        activityName: activity.name,
        systemType: activity.systemType,
        uploadCount: snapshot.uploadCountByActivityId.get(activity.id) ?? 0,
        interpretedUploadCount:
          snapshot.interpretedUploadCountByActivityId.get(activity.id) ?? 0,
        readyTableCount:
          snapshot.readyTableCountByActivityId.get(activity.id) ?? 0,
        status:
          (snapshot.readyTableCountByActivityId.get(activity.id) ?? 0) > 0 ||
          (snapshot.interpretedUploadCountByActivityId.get(activity.id) ?? 0) >
            0
            ? "already_ready"
            : (snapshot.uploadCountByActivityId.get(activity.id) ?? 0) > 0
              ? "blocked"
              : "no_uploads",
        startedCount: 0,
        skippedCount: 0,
        startedJobIds: [],
        uploadStates: snapshot.uploadStatesByActivityId.get(activity.id) ?? [],
      }));

    return {
      trigger,
      activityCount: snapshot.activities.length,
      candidateCount,
      readyTableCount: snapshot.tables.length,
      activityDiagnostics,
      reasons: listDiagnosticReasons(
        trigger,
        candidateCount,
        snapshot.tables,
        activityDiagnostics,
      ),
    };
  }

  private async collectProjectEvidenceSnapshot(
    userId: string,
    projectId: string,
  ): Promise<ProjectEvidenceSnapshot> {
    const activities = await this.activityRepository.listByProject(
      projectId,
      databaseSession,
    );
    const scopedActivities = activities.filter((activity) =>
      isOutcomeEvidenceSystemActivity(activity.systemType),
    );
    const mappedActivities = scopedActivities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      systemType: activity.systemType,
    }));

    if (scopedActivities.length === 0) {
      return {
        activities: mappedActivities,
        uploadCountByActivityId: new Map(),
        interpretedUploadCountByActivityId: new Map(),
        readyTableCountByActivityId: new Map(),
        uploadStatesByActivityId: new Map(),
        tables: [],
      };
    }

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      scopedActivities.map((activity) => activity.id),
      databaseSession,
    );
    const uploadCountByActivityId = new Map<string, number>();
    const uploadStatesByActivityId = new Map<
      string,
      OutcomeEvidencePairingActivityUploadState[]
    >();
    for (const activity of mappedActivities) {
      const readiness =
        await this.interpretationService.inspectActivityInterpretationReadiness(
          userId,
          activity.id,
        );
      uploadStatesByActivityId.set(activity.id, readiness.uploadStates);
    }
    for (const upload of uploads) {
      if (!upload.activityId) {
        continue;
      }
      uploadCountByActivityId.set(
        upload.activityId,
        (uploadCountByActivityId.get(upload.activityId) ?? 0) + 1,
      );
    }

    if (uploads.length === 0) {
      return {
        activities: mappedActivities,
        uploadCountByActivityId,
        interpretedUploadCountByActivityId: new Map(),
        readyTableCountByActivityId: new Map(),
        uploadStatesByActivityId,
        tables: [],
      };
    }

    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const interpretedUploadCountByActivityId = new Map<string, number>();
    const activityIdByUploadMetadataId = new Map(
      uploads.map((upload) => [upload.id, upload.activityId]),
    );
    for (const result of results) {
      const activityId = activityIdByUploadMetadataId.get(
        result.uploadMetadataId,
      );
      if (!activityId) {
        continue;
      }
      interpretedUploadCountByActivityId.set(
        activityId,
        (interpretedUploadCountByActivityId.get(activityId) ?? 0) + 1,
      );
    }

    const preparations =
      await this.datasetPreparationRepository.findByInterpretationResultIds(
        results.map((result) => result.id),
        databaseSession,
      );
    const preparationByResultId = new Map(
      preparations.map((preparation) => [
        preparation.interpretationResultId,
        preparation,
      ]),
    );
    const readyTableCountByActivityId = new Map<string, number>();

    for (const result of results) {
      const activityId = activityIdByUploadMetadataId.get(
        result.uploadMetadataId,
      );
      const preparation = preparationByResultId.get(result.id);
      if (!activityId || !isReadyForPairingPreparation(preparation)) {
        continue;
      }

      readyTableCountByActivityId.set(
        activityId,
        (readyTableCountByActivityId.get(activityId) ?? 0) +
          preparation.preparedDataset.tables.length,
      );
    }

    const tables = await loadProjectEvidenceTablesForOutcomePairing(
      {
        activityRepository: this.activityRepository,
        uploadMetadataRepository: this.uploadMetadataRepository,
        interpretationResultRepository: this.interpretationResultRepository,
        datasetPreparationRepository: this.datasetPreparationRepository,
        privacySafeRepresentationRepository:
          this.privacySafeRepresentationRepository,
      },
      projectId,
    );

    return {
      activities: mappedActivities,
      uploadCountByActivityId,
      interpretedUploadCountByActivityId,
      readyTableCountByActivityId,
      uploadStatesByActivityId,
      tables,
    };
  }

  async decideProposal(
    userId: string,
    projectId: string,
    proposalId: string,
    decision: OutcomeEvidencePairingProposalDecision,
    outcomeId: string | null,
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidencePairingResultRecord> {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    if (decision === "assign" && !outcomeId) {
      throw new AppError(
        "An outcomeId is required when assigning a proposal to a declared outcome.",
        400,
        "outcome_evidence_pairing_outcome_id_required",
      );
    }

    const current = await this.reconcilePairingResult(
      project.id,
      project.organizationId,
      language,
    );
    const snapshot = await this.collectProjectEvidenceSnapshot(
      userId,
      project.id,
    );
    const allCandidates = computeOutcomeEvidencePairingCandidates(
      snapshot.tables,
    );
    const proposal =
      decision === "assign"
        ? allCandidates.find((entry) => entry.proposalId === proposalId)
        : current.proposals.find((entry) => entry.proposalId === proposalId);
    if (!proposal) {
      throw new AppError(
        decision === "assign"
          ? "This deterministic evidence option is no longer available for this project."
          : "This outcome-evidence pairing proposal was not found or has already been resolved.",
        404,
        "outcome_evidence_pairing_proposal_not_found",
      );
    }

    if (decision === "assign" && outcomeId) {
      // Closed-list, server-validated: outcomeId must reference an
      // existing ProjectOutcomeStatement for this project, never a
      // fuzzy-text guess — see IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §4.
      const outcomeStatement =
        await this.projectOutcomeStatementRepository.findById(
          outcomeId,
          databaseSession,
        );
      if (!outcomeStatement || outcomeStatement.projectId !== project.id) {
        throw new AppError(
          "This outcome statement was not found for this project.",
          404,
          "project_outcome_statement_not_found",
        );
      }

      const existingLinks =
        await this.outcomeEvidenceLinkRepository.listByProjectId(
          project.id,
          databaseSession,
        );
      const existingProposalIds = new Set(
        existingLinks.map((link) => buildProposalIdFromConfirmedLink(link)),
      );
      if (existingProposalIds.has(proposalId)) {
        throw new AppError(
          "This evidence option has already been confirmed.",
          409,
          "outcome_evidence_link_already_confirmed",
        );
      }

      const confirmedAt = new Date();
      if (proposal.shape === "paired_delta") {
        await this.outcomeEvidenceLinkRepository.create(
          {
            organizationId: project.organizationId,
            projectId: project.id,
            outcomeId,
            shape: "paired_delta",
            activityIdBefore: proposal.activityIdBefore,
            activityIdAfter: proposal.activityIdAfter,
            beforeUploadMetadataId: proposal.beforeUploadMetadataId,
            beforeTableName: proposal.beforeTableName,
            beforeColumnName: proposal.beforeColumnName,
            afterUploadMetadataId: proposal.afterUploadMetadataId,
            afterTableName: proposal.afterTableName,
            afterColumnName: proposal.afterColumnName,
            matchKey: proposal.matchKey,
            pairingGroupKey: proposal.pairingGroupKey,
            confirmedById: userId,
            confirmedAt: confirmedAt.toISOString(),
          },
          databaseSession,
        );
      } else {
        await this.outcomeEvidenceLinkRepository.create(
          {
            organizationId: project.organizationId,
            projectId: project.id,
            outcomeId,
            shape: "single_distribution",
            activityId: proposal.activityId,
            uploadMetadataId: proposal.uploadMetadataId,
            tableName: proposal.tableName,
            categoryColumnName: proposal.categoryColumnName,
            confirmedById: userId,
            confirmedAt: confirmedAt.toISOString(),
          },
          databaseSession,
        );
      }
    }

    await this.outcomeEvidencePairingResultRepository.upsertProposalDecision(
      project.id,
      {
        proposalId,
        decision,
        outcomeId: decision === "assign" ? (outcomeId as string) : null,
        decidedById: userId,
        decidedAt: new Date().toISOString(),
      },
      databaseSession,
    );

    return this.proposeForProject(userId, project.id, language);
  }

  async removeConfirmedLink(
    userId: string,
    projectId: string,
    linkId: string,
    language: "de" | "en" = "de",
  ): Promise<OutcomeEvidencePairingResultRecord> {
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
        "This outcome evidence link was not found for this project.",
        404,
        "outcome_evidence_link_not_found",
      );
    }

    await this.outcomeEvidenceLinkRepository.deleteById(
      linkId,
      databaseSession,
    );
    return this.proposeForProject(userId, project.id, language);
  }
}
