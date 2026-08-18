import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";

/**
 * Derived state in Impact Atlas is intentionally persisted, not rebuilt on
 * every read. When upstream verified evidence changes or disappears, the
 * project knowledge model must be marked stale so downstream consumers rebuild
 * from fresh evidence.
 */
export class ProjectDerivedStateInvalidationService {
  constructor(
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
  ) {}

  async invalidateProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await this.projectKnowledgeModelRepository.markStale(projectId, session);
  }
}
