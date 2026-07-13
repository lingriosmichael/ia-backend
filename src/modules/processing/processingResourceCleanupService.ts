import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeRelationshipRepository } from "../knowledge/knowledgeRelationshipRepository.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { EntityMappingRepository } from "./entityMappingRepository.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "./privacySafeRepresentationRepository.js";

export class ProcessingResourceCleanupService {
  constructor(
    private readonly parsedRepresentationRepository: ParsedRepresentationRepository,
    private readonly privacyReviewRepository: PrivacyReviewRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly entityMappingRepository: EntityMappingRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeRelationshipRepository: KnowledgeRelationshipRepository,
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
      this.entityMappingRepository.deleteByProjectId(projectId, session),
      this.interpretationResultRepository.deleteByProjectId(projectId, session),
      this.knowledgeRelationshipRepository.deleteByProjectId(
        projectId,
        session,
      ),
      this.knowledgeEntityRepository.deleteByProjectId(projectId, session),
      this.projectKnowledgeModelRepository.deleteByProjectId(
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
      this.entityMappingRepository.deleteByActivityId(activityId, session),
      this.interpretationResultRepository.deleteByActivityId(
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
      this.entityMappingRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
      this.interpretationResultRepository.deleteByUploadMetadataId(
        uploadMetadataId,
        session,
      ),
    ]);
  }
}
