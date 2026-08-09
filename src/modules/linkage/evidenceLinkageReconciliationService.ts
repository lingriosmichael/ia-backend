import { databaseSession } from "../../shared/database/databaseClient.js";
import type { FastifyBaseLogger } from "fastify";
import type { ActivityEvidenceLinkageGroup } from "../../shared/contracts.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import { loadLinkageEvidenceTablesForActivity } from "./linkageEvidenceLoader.js";
import { computeLinkageCandidates } from "./linkageCandidateMatcher.js";
import { reconcileEvidenceLinkageGroups } from "./linkageEntityReconciler.js";
import {
  buildConcernTaggingEntitiesForGroup,
  applyConcernTaggingResults,
} from "./linkageConcernTagging.js";
import type { ActivityEvidenceLinkageResultRepository } from "./activityEvidenceLinkageResultRepository.js";
import type { ActivityEvidenceLinkageResultPersistenceRecord } from "./activityEvidenceLinkageResultPersistence.js";

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

    const candidates = computeLinkageCandidates(tables);
    this.logger.info(
      { activityId, tableCount: tables.length, candidates },
      candidates.length > 0
        ? "evidence linkage: candidate join columns found across upload pairs"
        : "evidence linkage: no candidate join columns found between any pair of uploads",
    );

    const groups = reconcileEvidenceLinkageGroups(tables, candidates);
    const taggedGroups = await this.applyConcernTaggingIfConfigured(
      activityId,
      groups,
    );

    const result =
      await this.activityEvidenceLinkageResultRepository.upsertByActivityId(
        { organizationId, projectId, activityId, groups: taggedGroups },
        databaseSession,
      );

    this.logger.info(
      {
        activityId,
        groupCount: taggedGroups.length,
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

  // Opt-in: an activity with no concernTaggingInstruction never calls the
  // LLM here at all, and a failure calling it never fails the rest of
  // reconciliation (dedup/Tier-B/cohort-joins on real structured fields
  // are still correct and valuable without the derived flag) — logged
  // loudly rather than silently, though, per this service's own logging
  // already established for the rest of reconciliation.
  private async applyConcernTaggingIfConfigured(
    activityId: string,
    groups: ActivityEvidenceLinkageGroup[],
  ): Promise<ActivityEvidenceLinkageGroup[]> {
    if (groups.length === 0) {
      return groups;
    }

    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );
    const instruction = activity?.concernTaggingInstruction?.trim();
    if (!instruction) {
      return groups;
    }

    const taggedGroups: ActivityEvidenceLinkageGroup[] = [];
    for (const group of groups) {
      const entities = buildConcernTaggingEntitiesForGroup(group);
      if (entities.length === 0) {
        taggedGroups.push(group);
        continue;
      }

      try {
        const { results } = await this.pythonProcessingClient.runConcernTagging(
          {
            instruction,
            entities,
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
            flaggedCount: results.filter((result) => result.flagged).length,
          },
          "evidence linkage: concern tagging completed for this group",
        );
        taggedGroups.push(applyConcernTaggingResults(group, results));
      } catch (error) {
        this.logger.error(
          { activityId, joinKeyLabel: group.joinKeyLabel, error },
          "evidence linkage: concern tagging failed for this group, continuing without it",
        );
        taggedGroups.push(group);
      }
    }

    return taggedGroups;
  }
}
