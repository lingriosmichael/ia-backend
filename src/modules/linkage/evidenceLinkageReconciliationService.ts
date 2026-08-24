import { databaseSession } from "../../shared/database/databaseClient.js";
import type { FastifyBaseLogger } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import type {
  ActivityEvidenceLinkageGroup,
  ActivityEvidenceLinkageProposalDecision,
  ActivityEvidenceLinkageProposalRecord,
} from "../../shared/contracts.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type {
  ConcernTaggingResultOutput,
  PythonProcessingClient,
} from "../processing/pythonProcessingClient.js";
import { loadLinkageEvidenceTablesForActivity } from "./linkageEvidenceLoader.js";
import {
  computeLinkageCandidates,
  type LinkageCandidate,
} from "./linkageCandidateMatcher.js";
import { reconcileEvidenceLinkageGroups } from "./linkageEntityReconciler.js";
import {
  buildConcernTaggingEntitiesForGroup,
  buildConcernTagCache,
  applyConcernTaggingResults,
  partitionEntitiesByConcernTagCache,
} from "./linkageConcernTagging.js";
import type { ActivityEvidenceLinkageResultRepository } from "./activityEvidenceLinkageResultRepository.js";
import type { ActivityEvidenceLinkageResultPersistenceRecord } from "./activityEvidenceLinkageResultPersistence.js";

function getProposalId(candidate: LinkageCandidate): string {
  const left = [
    candidate.columnA.uploadMetadataId,
    candidate.columnA.tableName,
    candidate.columnA.columnName,
  ].join(":");
  const right = [
    candidate.columnB.uploadMetadataId,
    candidate.columnB.tableName,
    candidate.columnB.columnName,
  ].join(":");
  const [first, second] = [left, right].sort((a, b) => a.localeCompare(b));
  return `${candidate.matchBasis}|${first}|${second}`;
}

function toProposalRecord(
  candidate: LinkageCandidate,
): ActivityEvidenceLinkageProposalRecord {
  return {
    proposalId: getProposalId(candidate),
    uploadMetadataIdA: candidate.columnA.uploadMetadataId,
    uploadMetadataIdB: candidate.columnB.uploadMetadataId,
    tableNameA: candidate.columnA.tableName,
    tableNameB: candidate.columnB.tableName,
    columnNameA: candidate.columnA.columnName,
    columnNameB: candidate.columnB.columnName,
    matchBasis: candidate.matchBasis,
    confidence: candidate.confidence,
    overlapRatio: candidate.overlapRatio,
  };
}

/**
 * Builds and persists the joined entity table for an activity (§4 Tier
 * A/B/C resolution + §6 joined entity table).
 *
 * Persists a record (with `groups: []` if nothing was linkable) whenever
 * the activity has 2+ uploads with completed interpretation — the record's
 * mere existence is what lets `InterpretationService.getActivityWorkflowStage`
 * (§11's gate, in the absence of any real backend lifecycle state to hook
 * into — see the design doc's correction note) tell "reconciliation ran and
 * found nothing to join" apart from "reconciliation hasn't run yet." Only
 * deletes when the activity genuinely has fewer than two uploads eligible
 * for linkage (e.g. after an upload was removed), so a since-removed upload
 * doesn't leave stale linkage behind.
 */
export class EvidenceLinkageReconciliationService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly activityEvidenceLinkageResultRepository: ActivityEvidenceLinkageResultRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async reconcileForActivity(
    activityId: string,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord | null> {
    const { organizationId, projectId, tables } =
      await loadLinkageEvidenceTablesForActivity(
        {
          uploadMetadataRepository: this.uploadMetadataRepository,
          interpretationResultRepository: this.interpretationResultRepository,
          datasetPreparationRepository: this.datasetPreparationRepository,
          privacySafeRepresentationRepository:
            this.privacySafeRepresentationRepository,
          logger: this.logger,
        },
        activityId,
      );

    if (!organizationId || !projectId) {
      await this.activityEvidenceLinkageResultRepository.deleteByActivityId(
        activityId,
        databaseSession,
      );
      return null;
    }

    const existingResult =
      await this.activityEvidenceLinkageResultRepository.findByActivityId(
        activityId,
        databaseSession,
      );
    const candidates = computeLinkageCandidates(tables);
    this.logger.info(
      { activityId, tableCount: tables.length, candidates },
      candidates.length > 0
        ? "evidence linkage: candidate join columns found across upload pairs"
        : "evidence linkage: no candidate join columns found between any pair of uploads",
    );

    const currentWeakProposalIds = new Set(
      candidates
        .filter((candidate) => candidate.matchBasis === "name_like_column")
        .map(getProposalId),
    );
    const proposalDecisions = (existingResult?.proposalDecisions ?? []).filter(
      (decision) => currentWeakProposalIds.has(decision.proposalId),
    );
    const decisionByProposalId = new Map(
      proposalDecisions.map((decision) => [decision.proposalId, decision]),
    );
    const autoCandidates = candidates.filter(
      (candidate) => candidate.matchBasis === "identifier_column",
    );
    const acceptedWeakCandidates = candidates.filter(
      (candidate) =>
        candidate.matchBasis === "name_like_column" &&
        decisionByProposalId.get(getProposalId(candidate))?.decision ===
          "accept",
    );
    const pendingProposals = candidates
      .filter(
        (candidate) =>
          candidate.matchBasis === "name_like_column" &&
          !decisionByProposalId.has(getProposalId(candidate)),
      )
      .map(toProposalRecord);

    const groups = reconcileEvidenceLinkageGroups(tables, [
      ...autoCandidates,
      ...acceptedWeakCandidates,
    ]);
    const { groups: taggedGroups, instructionUsed } =
      await this.applyConcernTaggingIfConfigured(
        activityId,
        groups,
        existingResult,
      );

    const result =
      await this.activityEvidenceLinkageResultRepository.upsertByActivityId(
        {
          organizationId,
          projectId,
          activityId,
          status: pendingProposals.length > 0 ? "needs_review" : "resolved",
          groups: taggedGroups,
          proposals: pendingProposals,
          proposalDecisions,
          concernTaggingInstruction: instructionUsed,
        },
        databaseSession,
      );

    this.logger.info(
      {
        activityId,
        status: result.status,
        groupCount: taggedGroups.length,
        pendingProposalCount: pendingProposals.length,
        entityCount: taggedGroups.reduce(
          (sum, group) => sum + group.entities.length,
          0,
        ),
        groups: taggedGroups.map((group) => ({
          joinKeyLabel: group.joinKeyLabel,
          linkedUploadMetadataIds: group.linkedUploadMetadataIds,
          entityCount: group.entities.length,
          duplicateRowsRemovedCount: group.duplicateRowsRemoved.length,
          conflictCount: group.conflicts.length,
        })),
      },
      taggedGroups.length > 0
        ? "evidence linkage reconciliation produced a joined entity table"
        : "evidence linkage reconciliation ran but found nothing linkable",
    );

    return result;
  }

  async reviewProposal(
    activityId: string,
    proposalId: string,
    decision: ActivityEvidenceLinkageProposalDecision,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord> {
    const current =
      (await this.activityEvidenceLinkageResultRepository.findByActivityId(
        activityId,
        databaseSession,
      )) ?? (await this.reconcileForActivity(activityId));

    if (!current) {
      throw new AppError(
        "There is no linkage review available for this activity.",
        404,
        "activity_linkage_review_not_found",
      );
    }

    const proposal = current.proposals.find(
      (entry) => entry.proposalId === proposalId,
    );
    if (!proposal) {
      throw new AppError(
        "This linkage proposal was not found or has already been resolved.",
        404,
        "activity_linkage_proposal_not_found",
      );
    }

    await this.activityEvidenceLinkageResultRepository.upsertProposalDecision(
      activityId,
      proposalId,
      decision,
      new Date(),
      databaseSession,
    );

    return (await this.reconcileForActivity(
      activityId,
    )) as ActivityEvidenceLinkageResultPersistenceRecord;
  }

  // Opt-in: an activity with no concernTaggingInstruction never calls the
  // LLM here at all, and a failure calling it never fails the rest of
  // reconciliation (dedup/Tier-B/cohort-joins on real structured fields
  // are still correct and valuable without the derived flag) — logged
  // loudly rather than silently, though, per this service's own logging
  // already established for the rest of reconciliation.
  //
  // reconcileForActivity runs on every GET of the linkage review (see the
  // class doc comment above), not just when evidence actually changes.
  // Without a cache, simply reloading the review page re-ran a live LLM
  // call for every entity on every view. previousResult's persisted groups
  // (from the last time this ran) are used as a cache, keyed by
  // (entityKey, exact free-text content) — a hit means "this exact text
  // was already classified under this exact instruction," so only
  // genuinely new or changed entities ever reach the LLM. The cache is
  // discarded entirely (not partially reused) whenever the instruction
  // itself has changed, since the same text can classify differently
  // under different instructions.
  private async applyConcernTaggingIfConfigured(
    activityId: string,
    groups: ActivityEvidenceLinkageGroup[],
    previousResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  ): Promise<{
    groups: ActivityEvidenceLinkageGroup[];
    instructionUsed: string | null;
  }> {
    if (groups.length === 0) {
      return { groups, instructionUsed: null };
    }

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    const instruction = activity?.concernTaggingInstruction?.trim();
    if (!instruction) {
      return { groups, instructionUsed: null };
    }

    const cache =
      previousResult?.concernTaggingInstruction === instruction
        ? buildConcernTagCache(previousResult.groups)
        : new Map<string, ConcernTaggingResultOutput>();

    const taggedGroups: ActivityEvidenceLinkageGroup[] = [];
    for (const group of groups) {
      const entities = buildConcernTaggingEntitiesForGroup(group);
      if (entities.length === 0) {
        taggedGroups.push(group);
        continue;
      }

      const { cached, uncached } = partitionEntitiesByConcernTagCache(
        entities,
        cache,
      );

      if (uncached.length === 0) {
        this.logger.info(
          {
            activityId,
            joinKeyLabel: group.joinKeyLabel,
            entityCount: entities.length,
          },
          "evidence linkage: concern tagging fully served from cache for this group, no LLM call",
        );
        taggedGroups.push(applyConcernTaggingResults(group, cached));
        continue;
      }

      try {
        const { results } = await this.pythonProcessingClient.runConcernTagging(
          {
            instruction,
            entities: uncached,
            // No per-activity language signal reaches reconciliation
            // (it runs as a side effect of interpretation events, not a
            // language-bearing user request) — "de" matches this
            // service's other language defaults until that's available.
            language: "de",
          },
        );
        this.logger.info(
          {
            activityId,
            joinKeyLabel: group.joinKeyLabel,
            entityCount: entities.length,
            cachedCount: cached.length,
            calledCount: uncached.length,
            flaggedCount: results.filter((result) => result.flagged).length,
          },
          "evidence linkage: concern tagging completed for this group",
        );
        taggedGroups.push(
          applyConcernTaggingResults(group, [...cached, ...results]),
        );
      } catch (error) {
        this.logger.error(
          { activityId, joinKeyLabel: group.joinKeyLabel, error },
          "evidence linkage: concern tagging failed for this group, continuing without it",
        );
        // Even on failure, still apply whatever was already resolved from
        // cache rather than discarding it along with the failed call.
        taggedGroups.push(
          cached.length > 0 ? applyConcernTaggingResults(group, cached) : group,
        );
      }
    }

    return { groups: taggedGroups, instructionUsed: instruction };
  }
}
