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
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import {
  clearActivityInterpretationAcknowledgmentIfPresent,
  hasPendingBlockingQuestions,
  isBlockingQuestion,
} from "./interpretationReviewState.js";
import {
  classifyInterpretationDataTypeFromPayload,
  getInterpretationSupportState,
  isInterpretationDataTypeSupported,
} from "../../shared/utils/interpretationDataType.js";

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
    private readonly projectKnowledgeBuilderService: ProjectKnowledgeBuilderService,
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

    const interpretationDataType = classifyInterpretationDataTypeFromPayload(
      privacySafeRepresentation.payload,
    );
    const interpretationSupportState = getInterpretationSupportState(
      interpretationDataType,
    );

    if (!isInterpretationDataTypeSupported(interpretationDataType)) {
      throw new AppError(
        interpretationSupportState === "insufficiently_extracted"
          ? "This evidence does not contain enough extracted structure for reliable interpretation."
          : "This evidence was parsed successfully, but its current data type is not yet supported for canonical interpretation.",
        409,
        interpretationSupportState === "insufficiently_extracted"
          ? "interpretation_data_type_insufficiently_extracted"
          : "interpretation_data_type_not_supported_yet",
        { interpretationDataType },
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

    const answeredQuestion = result.questions.find(
      (question) => question.id === questionId,
    );

    const updated = await this.interpretationResultRepository.answerQuestion(
      interpretationResultId,
      questionId,
      { answeredValue, answeredById: userId, answeredAt: new Date() },
      databaseSession,
    );

    if (!updated || !answeredQuestion) {
      throw new AppError(
        "This question was not found.",
        404,
        "interpretation_question_not_found",
      );
    }

    if (
      result.activityId &&
      answeredQuestion.status === "answered" &&
      answeredQuestion.answeredValue !== answeredValue &&
      isBlockingQuestion(answeredQuestion)
    ) {
      await clearActivityInterpretationAcknowledgmentIfPresent(
        this.activityRepository,
        result.activityId,
        databaseSession,
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

    if (result.activityId) {
      await clearActivityInterpretationAcknowledgmentIfPresent(
        this.activityRepository,
        result.activityId,
        databaseSession,
      );
    }

    return mapInterpretationResult(updated);
  }

  async setQualitativeFindingStatus(
    userId: string,
    interpretationResultId: string,
    qualitativeFindingId: string,
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
      await this.interpretationResultRepository.setQualitativeFindingStatus(
        interpretationResultId,
        qualitativeFindingId,
        status,
        databaseSession,
      );

    if (!updated) {
      throw new AppError(
        "This qualitative finding was not found.",
        404,
        "interpretation_qualitative_finding_not_found",
      );
    }

    if (result.activityId) {
      await clearActivityInterpretationAcknowledgmentIfPresent(
        this.activityRepository,
        result.activityId,
        databaseSession,
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
    const privacySafeRepresentations =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence to acknowledge.",
        409,
        "interpretation_review_incomplete",
      );
    }

    if (privacySafeRepresentations.length !== uploads.length) {
      throw new AppError(
        "Every evidence file must complete privacy-safe processing before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
      );
    }

    const unsupportedInterpretationDataTypes = privacySafeRepresentations
      .map((representation) =>
        classifyInterpretationDataTypeFromPayload(representation.payload),
      )
      .filter(
        (interpretationDataType) =>
          !isInterpretationDataTypeSupported(interpretationDataType),
      );

    if (unsupportedInterpretationDataTypes.length > 0) {
      throw new AppError(
        "Every evidence file must be on a supported interpretation data type before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
        {
          unsupportedInterpretationDataTypes: [
            ...new Set(unsupportedInterpretationDataTypes),
          ],
        },
      );
    }

    if (results.length !== uploads.length) {
      throw new AppError(
        "Every evidence file must be interpreted before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
      );
    }

    // The frontend already disables its acknowledgment button while
    // blocking questions remain pending, but that's a UX nicety, not the
    // real guarantee — same principle as privacy review approval. The
    // backend remains the source of truth for review completeness.
    if (hasPendingBlockingQuestions(results)) {
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

    // Acknowledgment is exactly the "verified evidence update" event the
    // Project Knowledge Model's own design anticipated as the automatic
    // rebuild trigger (see "Phase 4 — Project Knowledge Model.md",
    // "Versioning and Rebuild Lifecycle" — rebuilds stay explicit/
    // event-driven, never on a timer or on every page view). A rebuild
    // failure must never fail the acknowledgment itself — acknowledgment
    // already succeeded and is valid regardless; the rebuild is a
    // best-effort downstream projection of it. AnalyticsExecutionService
    // also self-heals for any activity acknowledged before this existed.
    try {
      await this.projectKnowledgeBuilderService.buildForProject(project.id);
    } catch (error) {
      this.logger.error(
        { projectId: project.id, activityId, error },
        "project knowledge model rebuild after acknowledgment failed",
      );
    }

    return mapActivity(
      { ...updatedActivity, projectOwnerId: project.ownerId },
      userId,
    );
  }
}
