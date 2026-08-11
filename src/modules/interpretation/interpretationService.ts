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
  ActivityEvidenceLinkageProposalDecision,
  ActivityEvidenceLinkageResultRecord,
  ActivitySummary,
  ActivityWorkflowStageRecord,
  ProjectInterpretationOverview,
  StartActivityInterpretationResponse,
  StartInterpretationResponse,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { EvidenceLinkageReconciliationService } from "../linkage/evidenceLinkageReconciliationService.js";
import type { ActivityEvidenceLinkageResultRepository } from "../linkage/activityEvidenceLinkageResultRepository.js";
import { computeActivityWorkflowStage } from "../activity/activityWorkflowStage.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import {
  clearActivityAiKnowledgeStateIfPresent,
  hasPendingBlockingQuestions,
  isBlockingQuestion,
} from "./interpretationReviewState.js";
import { DatasetPreparationService } from "./datasetPreparationService.js";
import {
  classifyEvidenceModalityFromPayload,
  getEvidenceModalitySupportState,
  isEvidenceModalitySupported,
} from "../../shared/utils/evidenceModality.js";
import { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";

function getProcessingJobCreatedTimestamp(
  job: Pick<ProcessingJobPersistenceRecord, "createdAt">,
) {
  const createdAt = job.createdAt instanceof Date ? job.createdAt : null;
  return createdAt ? createdAt.getTime() : 0;
}

function getLatestJobByUploadMetadataId(
  jobs: ProcessingJobPersistenceRecord[],
) {
  const latestJobByUploadId = new Map<string, ProcessingJobPersistenceRecord>();

  for (const job of jobs
    .filter(
      (
        job,
      ): job is ProcessingJobPersistenceRecord & { uploadMetadataId: string } =>
        typeof job.uploadMetadataId === "string",
    )
    .sort((left, right) => {
      return (
        getProcessingJobCreatedTimestamp(right) -
        getProcessingJobCreatedTimestamp(left)
      );
    })) {
    if (!latestJobByUploadId.has(job.uploadMetadataId)) {
      latestJobByUploadId.set(job.uploadMetadataId, job);
    }
  }

  return latestJobByUploadId;
}

function mapActivityEvidenceLinkageResult(
  record: import("../linkage/activityEvidenceLinkageResultPersistence.js").ActivityEvidenceLinkageResultPersistenceRecord | null,
): ActivityEvidenceLinkageResultRecord | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    status: record.status,
    groups: record.groups,
    proposals: record.proposals,
    proposalDecisions: record.proposalDecisions.map((decision) => ({
      ...decision,
      decidedAt: decision.decidedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

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
    private readonly datasetPreparationService: DatasetPreparationService,
    private readonly deterministicAnalysisService: DeterministicAnalysisService,
    private readonly quantitativeInterpretationSynthesisService: QuantitativeInterpretationSynthesisService,
    private readonly projectKnowledgeBuilderService: ProjectKnowledgeBuilderService,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly evidenceLinkageReconciliationService: EvidenceLinkageReconciliationService,
    private readonly activityEvidenceLinkageResultRepository: ActivityEvidenceLinkageResultRepository,
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

    const evidenceModality = classifyEvidenceModalityFromPayload(
      privacySafeRepresentation.payload,
    );
    const interpretationSupportState =
      getEvidenceModalitySupportState(evidenceModality);

    if (!isEvidenceModalitySupported(evidenceModality)) {
      throw new AppError(
        interpretationSupportState === "insufficiently_extracted"
          ? "This evidence does not contain enough extracted structure for reliable interpretation."
          : "This evidence was parsed successfully, but its current modality is not yet supported for canonical interpretation.",
        409,
        interpretationSupportState === "insufficiently_extracted"
          ? "interpretation_data_type_insufficiently_extracted"
          : "interpretation_data_type_not_supported_yet",
        { evidenceModality },
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

    if (uploadMetadata.activityId) {
      await clearActivityAiKnowledgeStateIfPresent(
        this.activityRepository,
        uploadMetadata.activityId,
        databaseSession,
      );
    }

    const updatedQueuedJob = await this.processingJobRepository.update(
      queuedJob.id,
      {
        payload: {
          ...(queuedJob.payload ?? {}),
          activityGoals: activity
            ? {
                activityType: activity.activityType,
                objectives: activity.objectives,
                output: activity.output,
                outcome: activity.outcome,
              }
            : null,
          projectGoals: {
            projectGoal: project.projectGoal,
            impactModel: project.impactModel,
            successIndicators: project.successIndicators,
          },
        },
      },
      databaseSession,
    );

    return { job: mapProcessingJob(updatedQueuedJob) };
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
    const preparations =
      await this.datasetPreparationService.findByInterpretationResultIds(
        results.map((result) => result.id),
      );
    const deterministicAnalyses =
      await this.deterministicAnalysisService.findByInterpretationResultIds(
        results.map((result) => result.id),
      );
    const preparationByResultId = new Map(
      preparations.map((preparation) => [
        preparation.interpretationResultId,
        preparation,
      ]),
    );
    const deterministicAnalysisByResultId = new Map(
      deterministicAnalyses.map((analysis) => [
        analysis.interpretationResultId,
        analysis,
      ]),
    );

    return {
      results: results.map((result) =>
        mapInterpretationResult({
          ...result,
          datasetPreparation: preparationByResultId.get(result.id) ?? null,
          deterministicAnalysis:
            deterministicAnalysisByResultId.get(result.id) ?? null,
        }),
      ),
    };
  }

  async startActivityInterpretation(
    userId: string,
    activityId: string,
    language: "de" | "en",
  ): Promise<StartActivityInterpretationResponse> {
    await this.authorizationService.canEditActivity(userId, activityId);

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence to interpret.",
        409,
        "activity_interpretation_not_ready",
      );
    }

    const privacySafeRepresentations =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const latestResults =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const jobs = await this.processingJobRepository.listByActivity(
      activityId,
      databaseSession,
    );
    const privacySafeRepresentationByUploadId = new Map(
      privacySafeRepresentations.map((representation) => [
        representation.uploadMetadataId,
        representation,
      ]),
    );
    const latestJobByUploadId = getLatestJobByUploadMetadataId(jobs);
    const latestResultByUploadId = new Map(
      latestResults.map((result) => [result.uploadMetadataId, result]),
    );
    const activeUploadIds = new Set(
      [...latestJobByUploadId.values()]
        .filter(
          (job) =>
            job.status !== "completed" &&
            job.status !== "failed" &&
            job.status !== "cancelled",
        )
        .map((job) => job.uploadMetadataId),
    );

    const eligibleUploads = uploads.filter((upload) => {
      if (activeUploadIds.has(upload.id)) {
        return false;
      }
      if (latestResultByUploadId.has(upload.id)) {
        return false;
      }

      const privacySafeRepresentation = privacySafeRepresentationByUploadId.get(
        upload.id,
      );
      if (!privacySafeRepresentation) {
        return false;
      }

      const evidenceModality = classifyEvidenceModalityFromPayload(
        privacySafeRepresentation.payload,
      );
      return isEvidenceModalitySupported(evidenceModality);
    });

    if (eligibleUploads.length === 0) {
      const uploadStates = uploads.map((upload) => {
        const latestJob = latestJobByUploadId.get(upload.id) ?? null;
        const privacySafeRepresentation =
          privacySafeRepresentationByUploadId.get(upload.id) ?? null;
        const evidenceModality = privacySafeRepresentation
          ? classifyEvidenceModalityFromPayload(
              privacySafeRepresentation.payload,
            )
          : null;

        let reason:
          | "active_job"
          | "already_interpreted"
          | "privacy_safe_representation_missing"
          | "unsupported_modality";

        if (activeUploadIds.has(upload.id)) {
          reason = "active_job";
        } else if (latestResultByUploadId.has(upload.id)) {
          reason = "already_interpreted";
        } else if (!privacySafeRepresentation) {
          reason = "privacy_safe_representation_missing";
        } else {
          reason = "unsupported_modality";
        }

        return {
          uploadMetadataId: upload.id,
          originalFileName: upload.originalFileName,
          reason,
          latestJobStatus: latestJob?.status ?? null,
          latestJobType: latestJob?.jobType ?? null,
          evidenceModality,
        };
      });

      this.logger.warn(
        {
          activityId,
          uploadCount: uploads.length,
          activeUploadCount: activeUploadIds.size,
          uploadStates,
        },
        "Activity interpretation blocked because no evidence is ready for AI interpretation.",
      );

      throw new AppError(
        "No evidence in this activity is ready for AI interpretation yet.",
        409,
        "activity_interpretation_not_ready",
        { uploadStates },
      );
    }

    const jobsStarted = [];
    for (const upload of eligibleUploads) {
      const started = await this.startInterpretation(
        userId,
        upload.id,
        language,
      );
      jobsStarted.push(started.job);
    }

    return {
      jobs: jobsStarted,
      startedCount: jobsStarted.length,
      skippedCount: uploads.length - jobsStarted.length,
    };
  }

  /**
   * Read-only, authoritative version of the workflow stage the webapp
   * currently only derives client-side (cross-evidence-linkage-design.md
   * §11). Computed fresh from current uploads/jobs/results/linkage state,
   * never stored, so it can't drift out of sync.
   */
  async getActivityWorkflowStage(
    userId: string,
    activityId: string,
  ): Promise<ActivityWorkflowStageRecord> {
    const { activity } = await this.authorizationService.canViewActivity(
      userId,
      activityId,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      return { activityId, stage: "no_evidence" };
    }

    const [jobs, results, linkageResult] = await Promise.all([
      this.processingJobRepository.listByActivity(activityId, databaseSession),
      this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      ),
      uploads.length >= 2
        ? this.activityEvidenceLinkageResultRepository.findByActivityId(
            activityId,
            databaseSession,
          )
        : Promise.resolve(null),
    ]);

    const stage = computeActivityWorkflowStage({
      isAcknowledged: Boolean(activity.interpretationAcknowledgedAt),
      uploadIds: uploads.map((upload) => upload.id),
      jobs,
      results,
      hasLinkageResultIfApplicable: linkageResult?.status === "resolved",
    });

    return { activityId, stage };
  }

  async getActivityLinkageReview(
    userId: string,
    activityId: string,
  ): Promise<ActivityEvidenceLinkageResultRecord | null> {
    await this.authorizationService.canViewActivity(userId, activityId);
    const record =
      await this.evidenceLinkageReconciliationService.reconcileForActivity(
        activityId,
      );
    return mapActivityEvidenceLinkageResult(record);
  }

  async reviewActivityLinkageProposal(
    userId: string,
    activityId: string,
    proposalId: string,
    decision: ActivityEvidenceLinkageProposalDecision,
  ): Promise<ActivityEvidenceLinkageResultRecord> {
    const { activity } = await this.authorizationService.canEditActivity(
      userId,
      activityId,
    );
    const record = await this.evidenceLinkageReconciliationService.reviewProposal(
      activity.id,
      proposalId,
      decision,
    );

    return mapActivityEvidenceLinkageResult(
      record,
    ) as ActivityEvidenceLinkageResultRecord;
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

    const datasetPreparation =
      await this.datasetPreparationService.findByInterpretationResultId(
        result.id,
      );
    const deterministicAnalysis =
      await this.deterministicAnalysisService.findByInterpretationResultId(
        result.id,
      );

    return mapInterpretationResult({
      ...result,
      datasetPreparation,
      deterministicAnalysis,
    });
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
      ((answeredQuestion.status === "answered" &&
        answeredQuestion.answeredValue !== answeredValue &&
        isBlockingQuestion(answeredQuestion)) ||
        answeredQuestion.status !== "answered")
    ) {
      await clearActivityAiKnowledgeStateIfPresent(
        this.activityRepository,
        result.activityId,
        databaseSession,
      );
    }
    const datasetPreparation =
      await this.datasetPreparationService.syncForInterpretationResult(updated);
    const deterministicAnalysis =
      await this.deterministicAnalysisService.syncForInterpretationResult(
        updated,
        datasetPreparation,
      );
    const updatedPreparation =
      deterministicAnalysis.status === "ready"
        ? await this.datasetPreparationService.markAnalysisCompleted(
            datasetPreparation,
          )
        : datasetPreparation;
    // Failure here (e.g. the python-service call timing out) is caught and
    // persisted as a visible synthesisStatus on the result itself by
    // QuantitativeInterpretationSynthesisService — not swallowed. Anything
    // that escapes this call is a genuinely unexpected failure and should
    // propagate rather than be hidden behind a null fallback.
    const synthesized =
      await this.quantitativeInterpretationSynthesisService.maybeSyncForInterpretationResult(
        updated,
        updatedPreparation,
        deterministicAnalysis,
      );

    if (updated.activityId) {
      await this.evidenceLinkageReconciliationService
        .reconcileForActivity(updated.activityId)
        .catch((error: unknown) => {
          this.logger.error(
            {
              activityId: updated.activityId,
              interpretationResultId: updated.id,
              questionId,
              error,
            },
            "evidence linkage reconciliation could not be completed after a question answer",
          );
        });
    }

    return mapInterpretationResult({
      ...(synthesized ?? updated),
      datasetPreparation: updatedPreparation,
      deterministicAnalysis,
    });
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

    const unsupportedEvidenceModalities = privacySafeRepresentations
      .map((representation) =>
        classifyEvidenceModalityFromPayload(representation.payload),
      )
      .filter(
        (evidenceModality) => !isEvidenceModalitySupported(evidenceModality),
      );

    if (unsupportedEvidenceModalities.length > 0) {
      throw new AppError(
        "Every evidence file must be on a supported evidence modality before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
        {
          unsupportedEvidenceModalities: [
            ...new Set(unsupportedEvidenceModalities),
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
      {
        ...updatedActivity,
        projectOwnerId: project.ownerId,
        projectStatus: project.status,
      },
      userId,
    );
  }
}
