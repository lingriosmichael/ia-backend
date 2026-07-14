import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProjectPersistenceRecord } from "../project/projectPersistence.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { DashboardCatalogAssemblerService } from "./dashboardCatalogAssemblerService.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { PythonAnalyticsCurationClient } from "./pythonAnalyticsCurationClient.js";
import {
  CURATOR_MODEL_VERSION,
  type AnalyticsExecutionStatus,
  type AnalyticsScope,
  type DashboardCuration,
  type ProjectContextForCuration,
} from "./analyticsContracts.js";
import { AppError } from "../../shared/errors/appError.js";

const EMPTY_CATALOG_CURATION: DashboardCuration = {
  featuredEntryIds: [],
  narrative: [],
  groundingStatus: "PASSED",
  groundingRetryCount: 0,
  curatorModelVersion: CURATOR_MODEL_VERSION,
  fellBackToSelectionOnly: false,
};

/**
 * Section 11 of "Phase 5 — Deterministic Analytics.md": authorize, create
 * an execution record, assemble the catalog, call the Python curator,
 * persist the result, manage statuses. No calculation happens here or
 * anywhere downstream of it in this class — that already happened in
 * Phase 4.
 */
export class AnalyticsExecutionService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly dashboardCatalogAssemblerService: DashboardCatalogAssemblerService,
    private readonly analyticsExecutionRepository: AnalyticsExecutionRepository,
    private readonly analyticsResultRepository: AnalyticsResultRepository,
    private readonly pythonAnalyticsCurationClient: PythonAnalyticsCurationClient,
    private readonly projectKnowledgeBuilderService: ProjectKnowledgeBuilderService,
  ) {}

  async generateForProject(
    userId: string,
    projectId: string,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
    return this.generate(
      project.organizationId,
      { type: "PROJECT", projectId, activityId: null },
      this.buildProjectContext(project),
    );
  }

  async generateForActivity(
    userId: string,
    projectId: string,
    activityId: string,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project, activity } = await this.authorizationService.canViewActivity(
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

    return this.generate(
      project.organizationId,
      { type: "ACTIVITY", projectId, activityId },
      this.buildProjectContext(project),
    );
  }

  private buildProjectContext(
    project: ProjectPersistenceRecord,
  ): ProjectContextForCuration {
    return {
      name: project.name,
      projectGoal: project.projectGoal,
      targetGroups: project.targetGroups,
      areaOfOperation: project.areaOfOperation,
    };
  }

  private async generate(
    organizationId: string,
    scope: AnalyticsScope,
    projectContext: ProjectContextForCuration,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const execution = await this.analyticsExecutionRepository.create(
      {
        organizationId,
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
        status: "RUNNING",
        startedAt: new Date(),
      },
      databaseSession,
    );

    try {
      let { catalog, projectKnowledgeModelStatus } =
        await this.dashboardCatalogAssemblerService.assemble(scope);

      // `null` means no model has ever been built for this project — most
      // commonly an activity acknowledged before the acknowledgment-time
      // auto-rebuild existed (see InterpretationService.acknowledgeReview).
      // `stale` means verified data has changed since the last build. Both
      // self-heal here rather than failing, so a user clicking "generate"
      // never has to know a separate manual script exists. `building` is
      // left alone — triggering a second concurrent build risks racing
      // the in-flight one's version increment.
      if (
        projectKnowledgeModelStatus === null ||
        projectKnowledgeModelStatus === "stale"
      ) {
        await this.projectKnowledgeBuilderService.buildForProject(
          scope.projectId,
        );
        ({ catalog, projectKnowledgeModelStatus } =
          await this.dashboardCatalogAssemblerService.assemble(scope));
      }

      if (projectKnowledgeModelStatus === "building") {
        return (
          (await this.analyticsExecutionRepository.updateStatus(
            execution.id,
            {
              status: "FAILED",
              completedAt: new Date(),
              errorCode: "knowledge_model_not_ready",
              errorMessage:
                "The Project Knowledge Model is already being rebuilt. Try again shortly.",
            },
            databaseSession,
          )) ?? execution
        );
      }

      const curation: DashboardCuration =
        catalog.entries.length > 0
          ? await this.pythonAnalyticsCurationClient.curate(
              catalog,
              projectContext,
              "de",
            )
          : EMPTY_CATALOG_CURATION;

      await this.analyticsResultRepository.create(
        {
          analyticsExecutionId: execution.id,
          organizationId,
          projectId: scope.projectId,
          activityId: scope.activityId,
          scopeType: scope.type,
          catalogVersion: catalog.catalogVersion,
          knowledgeModelVersion: catalog.knowledgeModelVersion,
          catalog,
          curation,
          dataQuality: {
            recordsExcludedCount: catalog.omittedEntries.length,
            warnings: catalog.omittedEntries.map((entry) => entry.reason),
          },
          limitations: catalog.omittedEntries.map((entry) => entry.reason),
          generatedAt: new Date(),
        },
        databaseSession,
      );

      const finalStatus: AnalyticsExecutionStatus =
        curation.fellBackToSelectionOnly
          ? "COMPLETED_WITH_WARNINGS"
          : "COMPLETED";
      return (
        (await this.analyticsExecutionRepository.updateStatus(
          execution.id,
          { status: finalStatus, completedAt: new Date() },
          databaseSession,
        )) ?? execution
      );
    } catch (error) {
      await this.analyticsExecutionRepository.updateStatus(
        execution.id,
        {
          status: "FAILED",
          completedAt: new Date(),
          errorCode: "analytics_generation_failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unknown error while generating analytics.",
        },
        databaseSession,
      );
      throw error;
    }
  }
}
