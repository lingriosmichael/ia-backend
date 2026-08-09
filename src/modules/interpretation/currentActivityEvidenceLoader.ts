import { databaseSession } from "../../shared/database/databaseClient.js";
import { classifyEvidenceModalityFromPayload } from "../../shared/utils/evidenceModality.js";
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

      evidence.push({
        uploadMetadataId: upload.id,
        privacySafeRepresentationId: representation.id,
        logicalEvidenceId: upload.logicalEvidenceId,
        versionNumber: upload.versionNumber,
        originalFileName: upload.originalFileName,
        evidenceModality: classifyEvidenceModalityFromPayload(
          representation.payload,
        ),
        uploadedAt: upload.createdAt,
        payload: representation.payload,
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
