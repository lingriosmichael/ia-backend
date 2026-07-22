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
  ActivityAiKnowledgeInsight,
  ActivityAiKnowledgeRecord,
  InterpretationIndicatorStatus,
  ProjectInterpretationOverview,
  StartActivityInterpretationResponse,
  StartInterpretationResponse,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
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
import type { DeterministicAnalysisPersistenceRecord } from "./deterministicAnalysisPersistence.js";
import type { InterpretationResultPersistenceRecord } from "./interpretationResultPersistence.js";
import type { ActivityAiKnowledgeSnapshotPersistenceRecord } from "../activity/activityPersistence.js";

interface ActivityAiKnowledgeDraft {
  id: string;
  sourceType: ActivityAiKnowledgeInsight["sourceType"];
  text: string;
  isGoalRelevant: boolean;
  sourceUploadMetadataIds: string[];
  confidence: number;
}

const MAX_CONTEXT_ONLY_FINDINGS = 2;

function normalizeInsightText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function ensureTerminalPunctuation(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function deduplicateInsights(
  drafts: ActivityAiKnowledgeDraft[],
): ActivityAiKnowledgeDraft[] {
  const seen = new Set<string>();
  const deduplicated: ActivityAiKnowledgeDraft[] = [];
  for (const draft of drafts) {
    const normalizedText = normalizeInsightText(draft.text).toLowerCase();
    if (!normalizedText || seen.has(normalizedText)) {
      continue;
    }
    seen.add(normalizedText);
    deduplicated.push({
      ...draft,
      text: ensureTerminalPunctuation(normalizeInsightText(draft.text)),
    });
  }
  return deduplicated;
}

function isGoalRelevantFinding(
  finding: InterpretationResultPersistenceRecord["qualitativeFindings"][number],
): boolean {
  return (
    finding.outcomeAnchorType !== "unanchored" ||
    finding.relationToEvidence !== "context_only" ||
    finding.category !== "context_only"
  );
}

function isIncludedInAiKnowledge(
  status: InterpretationIndicatorStatus,
): boolean {
  // The old review UI could explicitly reject indicators/findings. The
  // simplified flow now auto-keeps newly generated items, but the
  // persistence flag still exists for backward compatibility and for any
  // legacy records that were previously rejected.
  return status !== "rejected";
}

function formatCountOrPercent(
  count: number,
  ratio: number | null,
  language: "de" | "en",
): string {
  if (ratio !== null && Number.isFinite(ratio)) {
    const percentage = Math.round(ratio * 100);
    return language === "de"
      ? `${percentage} % (${count})`
      : `${percentage}% (${count})`;
  }

  return `${count}`;
}

function formatNullableCategoryValue(
  value: string | null,
  language: "de" | "en",
): string {
  if (value !== null && value.trim().length > 0) {
    return value.trim();
  }

  return language === "de" ? "unbekannt" : "unknown";
}

function buildDistributionSignalDrafts(
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  const drafts: ActivityAiKnowledgeDraft[] = [];

  for (const [
    interpretationResultId,
    analysis,
  ] of analysesByInterpretationResultId) {
    for (const distribution of analysis.distributions) {
      const meaningfulBuckets = distribution.buckets
        .filter((bucket) => bucket.count > 0)
        .sort((left, right) => right.count - left.count);
      if (meaningfulBuckets.length < 2) {
        continue;
      }

      const topBuckets = meaningfulBuckets.slice(0, 2);
      const bucketSummary = topBuckets
        .map(
          (bucket) =>
            `${formatNullableCategoryValue(bucket.value, language)} ${formatCountOrPercent(
              bucket.count,
              bucket.ratio,
              language,
            )}`,
        )
        .join(language === "de" ? ", gefolgt von " : ", followed by ");

      drafts.push({
        id: `${interpretationResultId}:${distribution.distributionKey}`,
        sourceType: "distribution_signal",
        text:
          language === "de"
            ? `${distribution.label}: die größten Anteile entfallen auf ${bucketSummary}`
            : `${distribution.label}: the largest shares are ${bucketSummary}`,
        isGoalRelevant: false,
        sourceUploadMetadataIds: [analysis.uploadMetadataId],
        confidence: 1,
      });
    }

    for (const breakdown of analysis.subgroupBreakdowns) {
      const meaningfulSegments = breakdown.segments
        .filter((segment) => segment.rowCount > 0)
        .sort((left, right) => right.rowCount - left.rowCount);
      if (meaningfulSegments.length < 2) {
        continue;
      }

      const topSegments = meaningfulSegments.slice(0, 2);
      const segmentSummary = topSegments
        .map(
          (segment) =>
            `${formatNullableCategoryValue(
              segment.value,
              language,
            )} ${formatCountOrPercent(
              segment.rowCount,
              segment.positiveRatio,
              language,
            )}`,
        )
        .join(language === "de" ? ", gefolgt von " : ", followed by ");

      drafts.push({
        id: `${interpretationResultId}:${breakdown.breakdownKey}`,
        sourceType: "distribution_signal",
        text:
          language === "de"
            ? `${breakdown.label}: die auffälligsten Segmente sind ${segmentSummary}`
            : `${breakdown.label}: the most notable segments are ${segmentSummary}`,
        isGoalRelevant: false,
        sourceUploadMetadataIds: [analysis.uploadMetadataId],
        confidence: 1,
      });
    }
  }

  return deduplicateInsights(drafts);
}

function buildActivityAiKnowledgeDrafts(
  results: InterpretationResultPersistenceRecord[],
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  const goalRelevantFindings = deduplicateInsights(
    results
      .flatMap((result) =>
        result.qualitativeFindings
          .filter(
            (finding) =>
              isIncludedInAiKnowledge(finding.status) &&
              isGoalRelevantFinding(finding),
          )
          .map((finding) => ({
            id: finding.id,
            sourceType: "qualitative_finding" as const,
            text: finding.summary,
            isGoalRelevant: true,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: finding.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence),
  );

  const contextOnlyFindings = deduplicateInsights(
    results
      .flatMap((result) =>
        result.qualitativeFindings
          .filter(
            (finding) =>
              isIncludedInAiKnowledge(finding.status) &&
              !isGoalRelevantFinding(finding),
          )
          .map((finding) => ({
            id: finding.id,
            sourceType: "qualitative_finding" as const,
            text: finding.summary,
            isGoalRelevant: false,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: finding.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, MAX_CONTEXT_ONLY_FINDINGS),
  );

  const goalAlignmentGaps = deduplicateInsights(
    results.flatMap((result) =>
      result.goalAlignment
        .filter((coverage) => !coverage.isSupportedByData)
        .map((coverage) => ({
          id: coverage.id,
          sourceType: "goal_alignment" as const,
          text: coverage.gapExplanation ?? coverage.goalSummary,
          isGoalRelevant: true,
          sourceUploadMetadataIds: [result.uploadMetadataId],
          confidence: 0.75,
        })),
    ),
  );

  const goalRelevantIndicators = deduplicateInsights(
    results
      .flatMap((result) =>
        result.indicators
          .filter(
            (indicator) =>
              isIncludedInAiKnowledge(indicator.status) &&
              (indicator.matchesStatedGoal ||
                indicator.relevanceStage === "outcome" ||
                indicator.relevanceStage === "impact"),
          )
          .map((indicator) => ({
            id: indicator.id,
            sourceType: "indicator" as const,
            text: indicator.name,
            isGoalRelevant: true,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: indicator.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence),
  );

  const distributionSignals = buildDistributionSignalDrafts(
    analysesByInterpretationResultId,
    language,
  );

  const goalRelevantDrafts = deduplicateInsights([
    ...goalRelevantFindings,
    ...goalAlignmentGaps,
    ...goalRelevantIndicators,
  ]);

  if (goalRelevantDrafts.length > 0) {
    return deduplicateInsights([
      ...goalRelevantDrafts,
      ...distributionSignals,
      ...contextOnlyFindings,
    ]);
  }

  const goalAlignmentFallback = deduplicateInsights(
    results.flatMap((result) =>
      result.goalAlignment.map((coverage) => ({
        id: coverage.id,
        sourceType: "goal_alignment" as const,
        text: coverage.isSupportedByData
          ? coverage.goalSummary
          : (coverage.gapExplanation ?? coverage.goalSummary),
        isGoalRelevant: true,
        sourceUploadMetadataIds: [result.uploadMetadataId],
        confidence: coverage.isSupportedByData ? 1 : 0.75,
      })),
    ),
  );

  return deduplicateInsights([
    ...goalAlignmentFallback,
    ...distributionSignals,
    ...contextOnlyFindings,
  ]);
}

function buildAiKnowledgeSummaryFallback(
  insights: Array<Pick<ActivityAiKnowledgeDraft, "text">>,
): string {
  if (insights.length === 0) {
    return "";
  }

  return insights
    .map((insight) =>
      ensureTerminalPunctuation(normalizeInsightText(insight.text)),
    )
    .join(" ");
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
  ) {}

  private async generateAiKnowledgeSummaryText(input: {
    scope: "activity" | "project";
    projectId: string;
    subjectName: string;
    interpretedEvidenceCount: number;
    insights: Array<{
      text: string;
      isGoalRelevant: boolean;
      activityName?: string;
    }>;
    language: "de" | "en";
    acknowledgedActivityCount?: number;
    activityGoals?: {
      objectives: string | null;
      successIndicators: string | null;
    } | null;
    projectGoals?: {
      projectGoal: string | null;
      impactModel: {
        inputs: string | null;
        activities: string | null;
        outputs: string | null;
        outcomes: string | null;
        impact: string | null;
      } | null;
      successIndicators: string | null;
    } | null;
  }): Promise<string> {
    if (input.insights.length === 0) {
      return "";
    }

    try {
      const summary =
        await this.pythonProcessingClient.generateAiKnowledgeSummary({
          scope: input.scope,
          subjectName: input.subjectName,
          interpretedEvidenceCount: input.interpretedEvidenceCount,
          acknowledgedActivityCount: input.acknowledgedActivityCount,
          insights: input.insights.map((insight) => ({
            text: insight.text,
            isGoalRelevant: insight.isGoalRelevant,
            activityName: insight.activityName,
          })),
          language: input.language,
          activityGoals: input.activityGoals,
          projectGoals: input.projectGoals,
        });
      await this.projectLlmTokenLedgerService.recordUsage(
        input.projectId,
        summary.llmUsage ?? null,
        databaseSession,
      );
      return (
        summary.summaryText.trim() ||
        buildAiKnowledgeSummaryFallback(input.insights)
      );
    } catch (error) {
      this.logger.error(
        { err: error, scope: input.scope, subjectName: input.subjectName },
        "Failed to generate AI knowledge summary text.",
      );
      return buildAiKnowledgeSummaryFallback(input.insights);
    }
  }

  private mapActivityAiKnowledgeRecord(
    activity: {
      id: string;
      name: string;
      aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
    },
    projectId: string,
  ): ActivityAiKnowledgeRecord {
    const snapshot = activity.aiKnowledgeSnapshot;

    if (!snapshot) {
      throw new AppError(
        "This activity has no generated AI knowledge yet.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    return {
      activityId: activity.id,
      projectId,
      activityName: activity.name,
      interpretedEvidenceCount: snapshot.interpretedEvidenceCount,
      totalEvidenceCount: snapshot.totalEvidenceCount,
      generatedAt: snapshot.generatedAt.toISOString(),
      summaryText: snapshot.summaryText,
      insights: snapshot.insights.map((insight) => ({
        id: insight.id,
        sourceType: insight.sourceType,
        text: insight.text,
        isGoalRelevant: insight.isGoalRelevant,
        sourceUploadMetadataIds: [...insight.sourceUploadMetadataIds],
      })),
    };
  }

  private async buildActivityAiKnowledgeSnapshot(input: {
    activity: {
      id: string;
      name: string;
      objectives: string | null;
      successIndicators: string | null;
    };
    project: {
      id: string;
      projectGoal: string | null;
      impactModel: {
        inputs: string | null;
        activities: string | null;
        outputs: string | null;
        outcomes: string | null;
        impact: string | null;
      } | null;
      successIndicators: string | null;
    };
    uploads: Array<{ id: string }>;
    results: InterpretationResultPersistenceRecord[];
    language: "de" | "en";
  }): Promise<ActivityAiKnowledgeSnapshotPersistenceRecord> {
    const deterministicAnalyses =
      await this.deterministicAnalysisService.findByInterpretationResultIds(
        input.results.map((result) => result.id),
      );
    const deterministicAnalysisByInterpretationResultId = new Map(
      deterministicAnalyses.map((analysis) => [
        analysis.interpretationResultId,
        analysis,
      ]),
    );
    const insightDrafts = buildActivityAiKnowledgeDrafts(
      input.results,
      deterministicAnalysisByInterpretationResultId,
      input.language,
    );
    const insights = insightDrafts.map((draft) => ({
      id: draft.id,
      sourceType: draft.sourceType,
      text: draft.text,
      isGoalRelevant: draft.isGoalRelevant,
      sourceUploadMetadataIds: draft.sourceUploadMetadataIds,
    }));
    const summaryText = await this.generateAiKnowledgeSummaryText({
      scope: "activity",
      projectId: input.project.id,
      subjectName: input.activity.name,
      interpretedEvidenceCount: input.results.length,
      insights,
      language: input.language,
      activityGoals: {
        objectives: input.activity.objectives,
        successIndicators: input.activity.successIndicators,
      },
      projectGoals: {
        projectGoal: input.project.projectGoal,
        impactModel: input.project.impactModel,
        successIndicators: input.project.successIndicators,
      },
    });

    return {
      generatedAt: new Date(),
      summaryText,
      interpretedEvidenceCount: input.results.length,
      totalEvidenceCount: input.uploads.length,
      insights,
    };
  }

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
                objectives: activity.objectives,
                successIndicators: activity.successIndicators,
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
    const activeUploadIds = new Set(
      jobs
        .filter(
          (job) =>
            job.uploadMetadataId !== null &&
            job.status !== "completed" &&
            job.status !== "failed" &&
            job.status !== "cancelled",
        )
        .map((job) => job.uploadMetadataId as string),
    );

    const eligibleUploads = uploads.filter((upload) => {
      if (activeUploadIds.has(upload.id)) {
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
      throw new AppError(
        "No evidence in this activity is ready for AI interpretation yet.",
        409,
        "activity_interpretation_not_ready",
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

  async getActivityAiKnowledge(
    userId: string,
    activityId: string,
  ): Promise<ActivityAiKnowledgeRecord> {
    const { activity, project } =
      await this.authorizationService.canViewActivity(userId, activityId);

    return this.mapActivityAiKnowledgeRecord(activity, project.id);
  }

  async generateActivityAiKnowledge(
    userId: string,
    activityId: string,
    language: "de" | "en" = "en",
  ): Promise<ActivityAiKnowledgeRecord> {
    const { activity, project } =
      await this.authorizationService.canEditActivity(userId, activityId);

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence yet.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    const activeJobs = await this.processingJobRepository.listByActivity(
      activityId,
      databaseSession,
    );
    const hasActiveInterpretationJob = activeJobs.some(
      (job) =>
        job.jobType === "dataset_interpretation" &&
        !["completed", "failed", "cancelled"].includes(job.status),
    );

    if (hasActiveInterpretationJob) {
      throw new AppError(
        "AI knowledge cannot be generated while interpretation is still running.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    if (results.length !== uploads.length) {
      throw new AppError(
        "All evidence in this activity must finish interpretation before AI knowledge is available.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    if (hasPendingBlockingQuestions(results)) {
      throw new AppError(
        "This activity still has unresolved clarification questions.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    const aiKnowledgeSnapshot = await this.buildActivityAiKnowledgeSnapshot({
      activity,
      project,
      uploads,
      results,
      language,
    });

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        aiKnowledgeSnapshot,
        interpretationAcknowledgedAt: new Date(),
        interpretationAcknowledgedById: userId,
      },
      databaseSession,
    );

    try {
      await this.projectKnowledgeBuilderService.buildForProject(project.id);
    } catch (error) {
      this.logger.error(
        { projectId: project.id, activityId, error },
        "project knowledge model rebuild after AI knowledge generation failed",
      );
    }

    return this.mapActivityAiKnowledgeRecord(updatedActivity, project.id);
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
    const synthesized = await this.quantitativeInterpretationSynthesisService
      .maybeSyncForInterpretationResult(
        updated,
        updatedPreparation,
        deterministicAnalysis,
      )
      .catch((error: unknown) => {
        this.logger.error(
          {
            interpretationResultId: updated.id,
            questionId,
            error,
          },
          "quantitative interpretation synthesis could not be completed after a question answer",
        );
        return null;
      });

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
      { ...updatedActivity, projectOwnerId: project.ownerId },
      userId,
    );
  }
}
