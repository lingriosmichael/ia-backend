import { databaseSession } from "../../shared/database/databaseClient.js";
import { classifyEvidenceModalityFromPayload } from "../../shared/utils/evidenceModality.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import { augmentPrivacySafePayloadWithApprovedQualitativeCodingReview } from "../processing/qualitativeCodingReviewSupport.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";

export interface CurrentActivityEvidenceItem {
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  logicalEvidenceId: string;
  versionNumber: number;
  originalFileName: string;
  evidenceModality: string | null;
  uploadedAt: Date;
  payload: Record<string, unknown>;
}

export interface CurrentActivityEvidenceSnapshot {
  organizationId: string | null;
  projectId: string | null;
  activityId: string;
  evidence: CurrentActivityEvidenceItem[];
  missingPrivacySafeUploads: Array<{
    uploadMetadataId: string;
    logicalEvidenceId: string;
    versionNumber: number;
    originalFileName: string;
  }>;
}

export class CurrentActivityEvidenceLoader {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly qualitativeCodingReviewRepository: QualitativeCodingReviewRepository,
  ) {}

  async load(activityId: string): Promise<CurrentActivityEvidenceSnapshot> {
    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );
    if (uploads.length === 0) {
      return {
        organizationId: null,
        projectId: null,
        activityId,
        evidence: [],
        missingPrivacySafeUploads: [],
      };
    }

    const privacySafeRepresentations =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const representationByUploadId = new Map(
      privacySafeRepresentations.map((representation) => [
        representation.uploadMetadataId,
        representation,
      ]),
    );

    // Batched rather than looked up per-upload inside the loop below — this
    // gate runs twice per POST/PATCH by design (see
    // ActivityAnalysisV2Service.assertReadyForV2Run's defensive re-check),
    // so an N-upload activity used to cost up to ~3N redundant Mongo round
    // trips from this lookup alone.
    const qualitativeCodingReviews =
      await this.qualitativeCodingReviewRepository.findByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const qualitativeCodingReviewByUploadId = new Map(
      qualitativeCodingReviews.map((review) => [
        review.uploadMetadataId,
        review,
      ]),
    );

    const evidence: CurrentActivityEvidenceItem[] = [];
    const missingPrivacySafeUploads: CurrentActivityEvidenceSnapshot["missingPrivacySafeUploads"] =
      [];

    for (const upload of uploads) {
      const representation = representationByUploadId.get(upload.id);
      if (!representation) {
        missingPrivacySafeUploads.push({
          uploadMetadataId: upload.id,
          logicalEvidenceId: upload.logicalEvidenceId,
          versionNumber: upload.versionNumber,
          originalFileName: upload.originalFileName,
        });
        continue;
      }

      const qualitativeCodingReview =
        qualitativeCodingReviewByUploadId.get(upload.id) ?? null;
      const augmentedPayload =
        augmentPrivacySafePayloadWithApprovedQualitativeCodingReview(
          representation.payload,
          qualitativeCodingReview,
        );

      evidence.push({
        uploadMetadataId: upload.id,
        privacySafeRepresentationId: representation.id,
        logicalEvidenceId: upload.logicalEvidenceId,
        versionNumber: upload.versionNumber,
        originalFileName: upload.originalFileName,
        evidenceModality: classifyEvidenceModalityFromPayload(augmentedPayload),
        uploadedAt: upload.createdAt,
        payload: augmentedPayload,
      });
    }

    return {
      organizationId: uploads[0]?.organizationId ?? null,
      projectId: uploads[0]?.projectId ?? null,
      activityId,
      evidence,
      missingPrivacySafeUploads,
    };
  }
}
