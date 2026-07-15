import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { AnalyticsResultPersistenceRecord } from "./analyticsResultPersistence.js";
import {
  CURATOR_MODEL_VERSION,
  type AnalyticsScope,
} from "./analyticsContracts.js";
import { AppError } from "../../shared/errors/appError.js";

const LIVE_EXECUTION_STATUSES = new Set([
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
]);

export interface AnalyticsQueryResult {
  execution: AnalyticsExecutionPersistenceRecord | null;
  result: AnalyticsResultPersistenceRecord | null;
}

/**
 * Section 9/11 of "Phase 5 — Deterministic Analytics.md": load the latest
 * result for a scope and apply lazy staleness detection — there is no
 * push-based invalidation trigger anywhere in this codebase (the Project
 * Knowledge Model rebuild itself is the same way: explicit, manual-only),
 * so this re-checks on every read instead.
 */
export class AnalyticsQueryService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly analyticsExecutionRepository: AnalyticsExecutionRepository,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
  ) {}

  async getProjectAnalytics(
    userId: string,
    projectId: string,
  ): Promise<AnalyticsQueryResult> {
    await this.authorizationService.canViewProject(userId, projectId);
    return this.getForScope({ type: "PROJECT", projectId, activityId: null });
  }

  async getActivityAnalytics(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<AnalyticsQueryResult> {
    const { activity } = await this.authorizationService.canViewActivity(
      userId,
      activityId,
    );
    if (activity.projectId !== projectId) {
      throw new AppError(
        "This activity does not belong to the given project.",
        404,
        "activity_not_in_project",
      );
    }

    return this.getForScope({ type: "ACTIVITY", projectId, activityId });
  }

  private async getForScope(
    scope: AnalyticsScope,
  ): Promise<AnalyticsQueryResult> {
    const [execution, result] = await Promise.all([
      this.analyticsExecutionRepository.findLatestByScope(
        scope,
        databaseSession,
      ),
      this.analyticsResultRepository.findLatestByScope(scope, databaseSession),
    ]);

    if (!execution || !result) {
      return { execution, result: null };
    }

    if (!LIVE_EXECUTION_STATUSES.has(execution.status)) {
      return { execution, result: null };
    }

    const model = await this.projectKnowledgeModelRepository.findByProjectId(
      scope.projectId,
      databaseSession,
    );

    if (model && model.status !== "ready") {
      const updated = await this.analyticsExecutionRepository.updateStatus(
        execution.id,
        { status: "STALE" },
        databaseSession,
      );
      return { execution: updated ?? execution, result: null };
    }

    // A result computed with no Project Knowledge Model at all carries
    // knowledgeModelVersion: 0 (see DashboardCatalogAssemblerService's
    // emptyCatalog). If there's still no model, that result is still
    // current relative to "nothing exists yet" — not stale. Only treat a
    // missing model as staleness when the result was actually computed
    // from a real model that has since disappeared (e.g. deleted).
    const isStale = model
      ? model.version !== result.knowledgeModelVersion ||
        result.curation.curatorModelVersion !== CURATOR_MODEL_VERSION
      : result.knowledgeModelVersion !== 0;

    if (!isStale) {
      return { execution, result };
    }

    const updated = await this.analyticsExecutionRepository.updateStatus(
      execution.id,
      { status: "STALE" },
      databaseSession,
    );
    return { execution: updated ?? execution, result: null };
  }
}
