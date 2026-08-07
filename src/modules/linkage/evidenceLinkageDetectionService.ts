import type { FastifyBaseLogger } from "fastify";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { loadLinkageEvidenceTablesForActivity } from "./linkageEvidenceLoader.js";
import {
  computeLinkageCandidates,
  type LinkageCandidate,
} from "./linkageCandidateMatcher.js";

export type {
  LinkageCandidate,
  LinkageCandidateColumnReference,
  LinkageCandidateConfidence,
  LinkageCandidateMatchBasis,
} from "./linkageCandidateMatcher.js";

/**
 * Detects candidate join keys across an activity's uploads by comparing
 * identifier/name-like column value overlap pairwise
 * (cross-evidence-linkage-design.md §3-4). Build step 1: read-only and
 * log-only on its own, but its output is also consumed directly by
 * EvidenceLinkageReconciliationService (§4/§6) to build the joined entity
 * table.
 */
export class EvidenceLinkageDetectionService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async detectForActivity(activityId: string): Promise<LinkageCandidate[]> {
    const { tables } = await loadLinkageEvidenceTablesForActivity(
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

    const candidates = computeLinkageCandidates(tables);

    this.logger.info(
      { activityId, tableCount: tables.length, candidates },
      candidates.length > 0
        ? "evidence linkage candidates detected across activity uploads"
        : "no evidence linkage candidates found across activity uploads",
    );

    return candidates;
  }
}
