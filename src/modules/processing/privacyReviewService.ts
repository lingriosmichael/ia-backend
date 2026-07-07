import type {
  ApprovePrivacyReviewResponse,
  PrivacyReviewDecisions,
  PrivacyReviewRecord,
} from "../../shared/contracts.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  mapParsedRepresentationPreview,
  mapPrivacyReview,
  mapProcessingJob,
} from "../../shared/utils/mappers.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import { PythonProcessingClient } from "./pythonProcessingClient.js";

function getExternalJobId(payload: Record<string, unknown> | null) {
  const pythonJob = payload?.pythonJob;
  if (!pythonJob || typeof pythonJob !== "object") {
    return null;
  }

  const externalJobId = (pythonJob as Record<string, unknown>).externalJobId;
  return typeof externalJobId === "string" && externalJobId.length > 0
    ? externalJobId
    : null;
}

export class PrivacyReviewService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
  ) {}

  async getByProcessingJobId(
    userId: string,
    processingJobId: string,
  ): Promise<PrivacyReviewRecord> {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, job.projectId);

    const review = await this.privacyReviewRepository.findByProcessingJobId(
      processingJobId,
      databaseSession,
    );

    const parsedRepresentation =
      await this.parsedRepresentationRepository.findByProcessingJobId(
        processingJobId,
        databaseSession,
      );

    if (!review) {
      throw new AppError(
        "Privacy review not found.",
        404,
        "privacy_review_not_found",
      );
    }

    return mapPrivacyReview({
      id: review.id,
      organizationId: review.organizationId,
      projectId: review.projectId,
      activityId: review.activityId,
      uploadMetadataId: review.uploadMetadataId,
      processingJobId: review.processingJobId,
      status: review.status,
      findings: review.findings,
      parsedRepresentationPreview: parsedRepresentation
        ? mapParsedRepresentationPreview({
            fileType: parsedRepresentation.fileType,
            payload: parsedRepresentation.payload,
          })
        : null,
      decisions: review.decisions,
      approvedById: review.approvedById,
      approvedAt: review.approvedAt,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    });
  }

  async approve(
    userId: string,
    processingJobId: string,
    decisions: PrivacyReviewDecisions | undefined,
  ): Promise<ApprovePrivacyReviewResponse> {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    await this.authorizationService.canEditProject(userId, job.projectId);

    if (job.jobType !== "evidence_processing") {
      throw new AppError(
        "Privacy approval is only supported for evidence processing jobs.",
        400,
        "privacy_review_job_type_invalid",
      );
    }

    if (job.status !== "awaiting_privacy_review") {
      throw new AppError(
        "Privacy review cannot be approved in the current job state.",
        409,
        "privacy_review_not_pending",
      );
    }

    const review = await this.privacyReviewRepository.findByProcessingJobId(
      processingJobId,
      databaseSession,
    );

    if (!review) {
      throw new AppError(
        "Privacy review not found.",
        404,
        "privacy_review_not_found",
      );
    }

    if (review.status !== "pending") {
      throw new AppError(
        "Privacy review has already been resolved.",
        409,
        "privacy_review_already_resolved",
      );
    }

    const externalJobId = getExternalJobId(job.payload);
    if (!externalJobId) {
      throw new AppError(
        "The external processing job reference is missing.",
        409,
        "python_processing_reference_missing",
      );
    }

    const approvedAt = new Date();
    const decisionsToApply = decisions ?? {};

    // Call the Python service first. If this fails (network blip, Python
    // downtime), the review must stay "pending" so the user can simply
    // retry — persisting "approved" first would permanently wedge the job,
    // since there is no unapprove/reset path once review.status leaves
    // "pending" (see the check above).
    const pythonResponse =
      await this.pythonProcessingClient.approvePrivacyReview(
        externalJobId,
        decisionsToApply,
      );

    // Atomic conditional update: the earlier findByProcessingJobId check
    // above is only for a clean 404/409 error message — this is the real
    // guard against two concurrent approvals both succeeding.
    const approvedReview = await this.privacyReviewRepository.approveIfPending(
      processingJobId,
      { decisions: decisionsToApply, approvedById: userId, approvedAt },
      databaseSession,
    );

    if (!approvedReview) {
      throw new AppError(
        "Privacy review has already been resolved.",
        409,
        "privacy_review_already_resolved",
      );
    }

    const updatedJob = await this.processingJobRepository.update(
      processingJobId,
      {
        status: "transforming",
        payload: {
          ...(job.payload ?? {}),
          pythonJob: {
            ...((job.payload?.pythonJob as
              Record<string, unknown> | undefined) ?? {}),
            externalJobId: pythonResponse.externalJobId,
            status: pythonResponse.status,
            updatedAt: pythonResponse.updatedAt,
            details: pythonResponse.details ?? null,
          },
        },
      },
      databaseSession,
    );

    return {
      review: mapPrivacyReview({
        id: approvedReview.id,
        organizationId: approvedReview.organizationId,
        projectId: approvedReview.projectId,
        activityId: approvedReview.activityId,
        uploadMetadataId: approvedReview.uploadMetadataId,
        processingJobId: approvedReview.processingJobId,
        status: approvedReview.status,
        findings: approvedReview.findings,
        parsedRepresentationPreview: null,
        decisions: approvedReview.decisions,
        approvedById: approvedReview.approvedById,
        approvedAt: approvedReview.approvedAt,
        createdAt: approvedReview.createdAt,
        updatedAt: approvedReview.updatedAt,
      }),
      job: mapProcessingJob(updatedJob),
    };
  }
}
