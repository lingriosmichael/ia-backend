import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  mapActivity,
  mapInterpretationResult,
  mapProcessingJob,
} from "../../shared/utils/mappers.js";
import type {
  ActivitySummary,
  InterpretationIndicatorStatus,
  ProjectInterpretationOverview,
  StartInterpretationResponse,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";

export class InterpretationService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async startInterpretation(
    userId: string,
    uploadMetadataId: string,
    language: "de" | "en",
  ): Promise<StartInterpretationResponse> {
    const uploadMetadata = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!uploadMetadata) {
      throw new AppError(
        "Evidence record not found.",
        404,
        "evidence_not_found",
      );
    }

    const { project } = await this.authorizationService.canEditProject(
      userId,
      uploadMetadata.projectId,
    );

    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (!privacySafeRepresentation) {
      throw new AppError(
        "This evidence has not completed privacy-safe processing yet.",
        409,
        "privacy_safe_representation_not_available",
      );
    }

    const activeJob =
      await this.processingJobRepository.findActiveByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (activeJob) {
      throw new AppError(
        "A processing job is already active for this evidence version.",
        409,
        "processing_job_already_active",
      );
    }

    const queuedJob = await this.processingJobRepository.create(
      {
        organizationId: uploadMetadata.organizationId,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        uploadMetadataId,
        triggeredById: userId,
        jobType: "dataset_interpretation",
        payload: {
          source: "phase_3_dataset_interpretation",
          privacySafeRepresentationId: privacySafeRepresentation.id,
          language,
        },
      },
      databaseSession,
    );

    this.logger.info(
      {
        processingJobId: queuedJob.id,
        uploadMetadataId,
        privacySafeRepresentationId: privacySafeRepresentation.id,
        language,
      },
      "starting dataset interpretation",
    );

    const activity = uploadMetadata.activityId
      ? await this.activityRepository.findById(
          uploadMetadata.activityId,
          databaseSession,
        )
      : null;

    try {
      const pythonJob =
        await this.pythonProcessingClient.startDatasetInterpretation({
          processingJobId: queuedJob.id,
          privacySafeRepresentationId: privacySafeRepresentation.id,
          payload: privacySafeRepresentation.payload,
          language,
          activityGoals: activity
            ? {
                objectives: activity.objectives,
                successIndicators: activity.successIndicators,
              }
            : null,
          projectGoals: {
            impactModel: project.impactModel,
            successIndicators: project.successIndicators,
          },
        });

      const startedJob = await this.processingJobRepository.update(
        queuedJob.id,
        {
          status: "processing",
          startedAt: new Date(),
          payload: {
            ...(queuedJob.payload ?? {}),
            pythonJob,
          },
        },
        databaseSession,
      );

      return { job: mapProcessingJob(startedJob) };
    } catch (error) {
      // The Python service being unreachable (wrong URL, not running, bad
      // shared secret) is the most likely cause here, and it's easy to miss
      // amid routine request logs — log the real error server-side so it's
      // not just a generic "failed" status with no trail to follow.
      this.logger.error(
        { processingJobId: queuedJob.id, error },
        "dataset interpretation could not be started",
      );

      const failedJob = await this.processingJobRepository.update(
        queuedJob.id,
        {
          status: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Interpretation could not be started.",
          completedAt: new Date(),
        },
        databaseSession,
      );

      return { job: mapProcessingJob(failedJob) };
    }
  }

  async getByProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectInterpretationOverview> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const activities = await this.activityRepository.listByProject(
      project.id,
      databaseSession,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      activities.map((activity) => activity.id),
      databaseSession,
    );

    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    return { results: results.map(mapInterpretationResult) };
  }

  async getById(userId: string, interpretationResultId: string) {
    const result = await this.interpretationResultRepository.findById(
      interpretationResultId,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "Interpretation result not found.",
        404,
        "interpretation_result_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, result.projectId);

    return mapInterpretationResult(result);
  }

  async answerQuestion(
    userId: string,
    interpretationResultId: string,
    questionId: string,
    answeredValue: string,
  ) {
    const result = await this.interpretationResultRepository.findById(
      interpretationResultId,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "Interpretation result not found.",
        404,
        "interpretation_result_not_found",
      );
    }

    await this.authorizationService.canEditProject(userId, result.projectId);

    const updated =
      await this.interpretationResultRepository.answerQuestionIfPending(
        interpretationResultId,
        questionId,
        { answeredValue, answeredById: userId, answeredAt: new Date() },
        databaseSession,
      );

    if (!updated) {
      throw new AppError(
        "This question was not found or has already been answered.",
        409,
        "interpretation_question_not_pending",
      );
    }

    return mapInterpretationResult(updated);
  }

  async setIndicatorStatus(
    userId: string,
    interpretationResultId: string,
    indicatorId: string,
    status: InterpretationIndicatorStatus,
  ) {
    const result = await this.interpretationResultRepository.findById(
      interpretationResultId,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "Interpretation result not found.",
        404,
        "interpretation_result_not_found",
      );
    }

    await this.authorizationService.canEditProject(userId, result.projectId);

    const updated =
      await this.interpretationResultRepository.setIndicatorStatus(
        interpretationResultId,
        indicatorId,
        status,
        databaseSession,
      );

    if (!updated) {
      throw new AppError(
        "This indicator was not found.",
        404,
        "interpretation_indicator_not_found",
      );
    }

    return mapInterpretationResult(updated);
  }

  async acknowledgeReview(
    userId: string,
    activityId: string,
  ): Promise<ActivitySummary> {
    const { project } = await this.authorizationService.canEditActivity(
      userId,
      activityId,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );
    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    // The frontend already disables its "Bestätigen" button while actionable
    // questions remain pending, but that's a UX nicety, not the real
    // guarantee — same principle as privacy review approval. The generic
    // "additional context" question (kind "free_text") is deliberately
    // optional and never blocks review; only merge-confirmation questions
    // (normalization) are actionable.
    const hasUnresolvedActionableQuestion = results.some((result) =>
      result.questions.some(
        (question) =>
          question.kind !== "free_text" && question.status === "pending",
      ),
    );

    if (hasUnresolvedActionableQuestion) {
      throw new AppError(
        "This activity still has unresolved clarification questions.",
        409,
        "interpretation_review_incomplete",
      );
    }

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        interpretationAcknowledgedAt: new Date(),
        interpretationAcknowledgedById: userId,
      },
      databaseSession,
    );

    return mapActivity(
      { ...updatedActivity, projectOwnerId: project.ownerId },
      userId,
    );
  }
}
