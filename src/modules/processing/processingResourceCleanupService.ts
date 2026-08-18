import mongoose from "mongoose";
import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { ActivityAnalysisRunV2Repository } from "../interpretation/activityAnalysisRunV2Repository.js";
import type { ProjectImpactStoryRepository } from "../projectImpactStory/projectImpactStoryRepository.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeIndicatorRepository } from "../knowledge/knowledgeIndicatorRepository.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { ActivityEvidenceLinkageResultRepository } from "../linkage/activityEvidenceLinkageResultRepository.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { QualitativeCodingReviewRepository } from "./qualitativeCodingReviewRepository.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";

const legacyAnalyticsCollectionNames = [
  "analytics_executions",
  "analytics_results",
  "analytics_dashboard_preferences",
  "analytics_dashboard_events",
] as const;

export class ProcessingResourceCleanupService {
  constructor(
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly qualitativeCodingReviewRepository: QualitativeCodingReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly deterministicAnalysisRepository: DeterministicAnalysisRepository,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeIndicatorRepository: KnowledgeIndicatorRepository,
    private readonly activityEvidenceLinkageResultRepository: ActivityEvidenceLinkageResultRepository,
    private readonly activityAnalysisRunV2Repository: ActivityAnalysisRunV2Repository,
    private readonly projectImpactStoryRepository: ProjectImpactStoryRepository,
  ) {}

  private async deleteLegacyAnalyticsDocuments(
    filter: { projectId?: string; activityId?: string },
    session: DatabaseSession,
  ): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Mongo database connection is not available.");
    }

    await Promise.all(
      legacyAnalyticsCollectionNames.map((collectionName) =>
        db
          .collection(collectionName)
          .deleteMany(filter, { session: session ?? undefined }),
      ),
    );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.parsedRepresentationRepository.deleteByProjectId(projectId, session),
      this.privacyReviewRepository.deleteByProjectId(projectId, session),
      this.qualitativeCodingReviewRepository.deleteByProjectId(
        projectId,
        session,
      ),
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
      this.deleteLegacyAnalyticsDocuments({ projectId }, session),
      this.activityEvidenceLinkageResultRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.activityAnalysisRunV2Repository.deleteByProjectId(
        projectId,
        session,
      ),
      this.projectImpactStoryRepository.deleteByProjectId(projectId, session),
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
      this.qualitativeCodingReviewRepository.deleteByActivityId(
        activityId,
        session,
      ),
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
      this.deleteLegacyAnalyticsDocuments({ activityId }, session),
      this.activityEvidenceLinkageResultRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.activityAnalysisRunV2Repository.deleteByActivityId(
        activityId,
        session,
      ),
    ]);
  }

  async deleteActivityAggregateStateByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.activityEvidenceLinkageResultRepository.deleteByActivityId(
        activityId,
        session,
      ),
      this.activityAnalysisRunV2Repository.deleteByActivityId(
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
      this.qualitativeCodingReviewRepository.deleteByUploadMetadataId(
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
