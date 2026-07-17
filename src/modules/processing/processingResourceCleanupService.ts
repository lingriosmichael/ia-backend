import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { AnalyticsDashboardPreferenceRepository } from "../analytics/analyticsDashboardPreferenceRepository.js";
import type { AnalyticsDashboardEventRepository } from "../analytics/analyticsDashboardEventRepository.js";
import type { AnalyticsExecutionRepository } from "../analytics/analyticsExecutionRepository.js";
import type { AnalyticsResultRepository } from "../analytics/analyticsResultRepository.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeIndicatorRepository } from "../knowledge/knowledgeIndicatorRepository.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";

export class ProcessingResourceCleanupService {
  constructor(
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly deterministicAnalysisRepository: DeterministicAnalysisRepository,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeIndicatorRepository: KnowledgeIndicatorRepository,
    private readonly analyticsExecutionRepository: AnalyticsExecutionRepository,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
    private readonly analyticsDashboardPreferenceRepository: AnalyticsDashboardPreferenceRepository,
    private readonly analyticsDashboardEventRepository: AnalyticsDashboardEventRepository,
  ) {}

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.parsedRepresentationRepository.deleteByProjectId(projectId, session),
      this.privacyReviewRepository.deleteByProjectId(projectId, session),
      this.privacySafeRepresentationRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.interpretationResultRepository.deleteByProjectId(projectId, session),
      this.datasetPreparationRepository.deleteByProjectId(projectId, session),
      this.deterministicAnalysisRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.knowledgeIndicatorRepository.deleteByProjectId(projectId, session),
      this.knowledgeEntityRepository.deleteByProjectId(projectId, session),
      this.projectKnowledgeModelRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.analyticsExecutionRepository.deleteByProjectId(projectId, session),
      this.analyticsResultRepository.deleteByProjectId(projectId, session),
      this.analyticsDashboardPreferenceRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.analyticsDashboardEventRepository.deleteByProjectId(
        projectId,
        session,
      ),
    ]);
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.parsedRepresentationRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.privacyReviewRepository.deleteByActivityId(activityId, session),
      this.privacySafeRepresentationRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.interpretationResultRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.datasetPreparationRepository.deleteByActivityId(activityId, session),
      this.deterministicAnalysisRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.analyticsDashboardEventRepository.deleteByActivityId(
        activityId,
        session,
      ),
    ]);
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.parsedRepresentationRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.privacyReviewRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.privacySafeRepresentationRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.interpretationResultRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.datasetPreparationRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.deterministicAnalysisRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
    ]);
  }
}
