import { databaseSession } from "../../shared/database/databaseClient.js";
import type { FastifyBaseLogger } from "fastify";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { loadLinkageEvidenceTablesForActivity } from "./linkageEvidenceLoader.js";
import { computeLinkageCandidates } from "./linkageCandidateMatcher.js";
import { reconcileEvidenceLinkageGroups } from "./linkageEntityReconciler.js";
import type { ActivityEvidenceLinkageResultRepository } from "./activityEvidenceLinkageResultRepository.js";
import type { ActivityEvidenceLinkageResultPersistenceRecord } from "./activityEvidenceLinkageResultPersistence.js";

/**
 * Builds and persists the joined entity table for an activity (§4 Tier
 * A/B/C resolution + §6 joined entity table), reusing the same evidence
 * loader and candidate detection as EvidenceLinkageDetectionService so both
 * always operate on identical join-key proposals.
 *
 * Persists a record (with `groups: []` if nothing was linkable) whenever
 * the activity has 2+ uploads with completed interpretation — the record's
 * mere existence is what lets `InterpretationService.generateActivityAiKnowledge`
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
    const groups = reconcileEvidenceLinkageGroups(tables, candidates);

    const result =
      await this.activityEvidenceLinkageResultRepository.upsertByActivityId(
        { organizationId, projectId, activityId, groups },
        databaseSession,
      );

    this.logger.info(
      {
        activityId,
        groupCount: groups.length,
        entityCount: groups.reduce(
          (sum, group) => sum + group.entities.length,
          0,
        ),
      },
      groups.length > 0
        ? "evidence linkage reconciliation produced a joined entity table"
        : "evidence linkage reconciliation ran but found nothing linkable",
    );

    return result;
  }
}
