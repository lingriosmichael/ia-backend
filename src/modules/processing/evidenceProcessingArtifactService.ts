import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import { UploadMetadataService } from "../upload/uploadMetadataService.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";

type ProcessingStatusDetails = Record<string, unknown> | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFileType(value: unknown): "spreadsheet" | "document" | "unknown" {
  return value === "spreadsheet" || value === "document" || value === "unknown"
    ? value
    : "unknown";
}

export class EvidenceProcessingArtifactService {
  constructor(
    private readonly uploadMetadataService: UploadMetadataService,
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
  ) {}

  async ingestProcessorArtifacts(
    job: ProcessingJobPersistenceRecord,
    details: ProcessingStatusDetails,
    targetStatus:
      | "queued"
      | "processing"
      | "awaiting_privacy_review"
      | "transforming"
      | "completed"
      | "failed"
      | "cancelled",
  ) {
    if (!job.uploadMetadataId || !isRecord(details)) {
      return;
    }

    await this.upsertParsedRepresentation(job, details);
    await this.upsertPrivacyReview(job, details);

    if (targetStatus === "completed") {
      await this.upsertPrivacySafeRepresentation(job, details);
      await this.uploadMetadataService.deleteOriginalFileAfterPrivacySafePersistence(
        job.uploadMetadataId,
      );
    }
  }

  private async upsertParsedRepresentation(
    job: ProcessingJobPersistenceRecord,
    details: Record<string, unknown>,
  ) {
    const parsedRepresentation = details.parsedRepresentation;
    if (!isRecord(parsedRepresentation) || !job.uploadMetadataId) {
      return;
    }

    await this.parsedRepresentationRepository.upsertByProcessingJobId(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        processingJobId: job.id,
        fileType: readFileType(parsedRepresentation.fileType),
        payload: isRecord(parsedRepresentation.payload)
          ? parsedRepresentation.payload
          : {},
      },
      databaseSession,
    );
  }

  private async upsertPrivacyReview(
    job: ProcessingJobPersistenceRecord,
    details: Record<string, unknown>,
  ) {
    const privacyReview = details.privacyReview;
    if (!isRecord(privacyReview) || !job.uploadMetadataId) {
      return;
    }

    await this.privacyReviewRepository.upsertByProcessingJobId(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        processingJobId: job.id,
        findings: isRecord(privacyReview.findings)
          ? privacyReview.findings
          : {},
      },
      databaseSession,
    );
  }

  private async upsertPrivacySafeRepresentation(
    job: ProcessingJobPersistenceRecord,
    details: Record<string, unknown>,
  ) {
    const privacySafeRepresentation = details.privacySafeRepresentation;
    if (!isRecord(privacySafeRepresentation) || !job.uploadMetadataId) {
      return;
    }

    const parsedRepresentation =
      await this.parsedRepresentationRepository.findByProcessingJobId(
        job.id,
        databaseSession,
      );
    const privacyReview =
      await this.privacyReviewRepository.findByProcessingJobId(
        job.id,
        databaseSession,
      );

    if (!parsedRepresentation || !privacyReview) {
      throw new AppError(
        "Processing artifacts are incomplete for privacy-safe persistence.",
        500,
        "processing_artifacts_incomplete",
      );
    }

    await this.privacySafeRepresentationRepository.upsertByProcessingJobId(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        processingJobId: job.id,
        privacyReviewId: privacyReview.id,
        parsedRepresentationId: parsedRepresentation.id,
        payload: isRecord(privacySafeRepresentation.payload)
          ? privacySafeRepresentation.payload
          : {},
      },
      databaseSession,
    );
  }
}
