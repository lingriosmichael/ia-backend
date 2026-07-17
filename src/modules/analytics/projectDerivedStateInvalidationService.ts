import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsDashboardPreferenceRepository } from "./analyticsDashboardPreferenceRepository.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";

/**
 * Derived state in Impact Atlas is intentionally persisted, not rebuilt on
 * every read. When upstream verified evidence changes or disappears, these
 * projections must be invalidated explicitly so stale dashboards never
 * outlive the evidence they were built from.
 */
export class ProjectDerivedStateInvalidationService {
  constructor(
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly analyticsExecutionRepository: AnalyticsExecutionRepository,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
    private readonly analyticsDashboardPreferenceRepository: AnalyticsDashboardPreferenceRepository,
  ) {}

  async invalidateProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      this.projectKnowledgeModelRepository.markStale(projectId, session),
      this.analyticsExecutionRepository.deleteByProjectId(projectId, session),
      this.analyticsResultRepository.deleteByProjectId(projectId, session),
      this.analyticsDashboardPreferenceRepository.deleteByProjectId(
        projectId,
        session,
      ),
    ]);
  }
}
