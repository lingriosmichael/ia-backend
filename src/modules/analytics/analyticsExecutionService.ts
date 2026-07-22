import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  ProjectKnowledgeModelBuildInProgressError,
  type ProjectKnowledgeBuilderService,
} from "../knowledge/projectKnowledgeBuilderService.js";
import type { DashboardCatalogAssemblerService } from "./dashboardCatalogAssemblerService.js";
import { buildProjectContextForCuration } from "./projectContextForCurationBuilder.js";
import type { AnalyticsExecutionRepository } from "./analyticsExecutionRepository.js";
import type { AnalyticsExecutionPersistenceRecord } from "./analyticsExecutionPersistence.js";
import type { AnalyticsResultRepository } from "./analyticsResultRepository.js";
import type { PythonAnalyticsCurationClient } from "./pythonAnalyticsCurationClient.js";
import {
  CURATOR_MODEL_VERSION,
  type AnalyticsDashboardWidgetCopyCandidate,
  type AnalyticsExecutionStatus,
  type AnalyticsScope,
  type DashboardCuration,
  type ProjectContextForCuration,
} from "./analyticsContracts.js";
import { AppError } from "../../shared/errors/appError.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";
import type { AnalyticsDashboardBuilderService } from "./analyticsDashboardBuilderService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { ProjectRepository } from "../project/projectRepository.js";

const EMPTY_CATALOG_CURATION: DashboardCuration = {
  featuredEntryIds: [],
  narrative: [],
  groundingStatus: "PASSED",
  groundingRetryCount: 0,
  curatorModelVersion: CURATOR_MODEL_VERSION,
  fellBackToSelectionOnly: false,
};
const IN_FLIGHT_EXECUTION_STATUSES = new Set(["QUEUED", "RUNNING"]);
const analyticsWorkerLeaseDurationMs = 120_000;
const knowledgeModelRetryDelayMs = 30_000;

function uniqueWarnings(messages: string[]): string[] {
  return [...new Set(messages)];
}

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
    private readonly deterministicAnalysisRepository: DeterministicAnalysisRepository,
    private readonly analyticsDashboardBuilderService: AnalyticsDashboardBuilderService,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly projectRepository: ProjectRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async generateForProject(
    userId: string,
    projectId: string,
    language: "de" | "en" = "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
    return this.generate(
      project.organizationId,
      { type: "PROJECT", projectId, activityId: null },
      buildProjectContextForCuration(project),
      language,
    );
  }

  async enqueueForProject(
    userId: string,
    projectId: string,
    language: "de" | "en" = "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
    return this.enqueueGeneration(
      project.organizationId,
      { type: "PROJECT", projectId, activityId: null },
      buildProjectContextForCuration(project),
      language,
    );
  }

  async generateForActivity(
    userId: string,
    projectId: string,
    activityId: string,
    language: "de" | "en" = "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project, activity } =
      await this.authorizationService.canViewActivity(userId, activityId);
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
      buildProjectContextForCuration(project),
      language,
    );
  }

  async enqueueForActivity(
    userId: string,
    projectId: string,
    activityId: string,
    language: "de" | "en" = "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const { project, activity } =
      await this.authorizationService.canViewActivity(userId, activityId);
    if (activity.projectId !== projectId) {
      throw new AppError(
        "This activity does not belong to the given project.",
        404,
        "activity_not_in_project",
      );
    }

    return this.enqueueGeneration(
      project.organizationId,
      { type: "ACTIVITY", projectId, activityId },
      buildProjectContextForCuration(project),
      language,
    );
  }

  private async generate(
    organizationId: string,
    scope: AnalyticsScope,
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const execution = await this.analyticsExecutionRepository.create(
      {
        organizationId,
        projectId: scope.projectId,
        activityId: scope.activityId,
        scopeType: scope.type,
        language,
        status: "RUNNING",
        startedAt: new Date(),
      },
      databaseSession,
    );

    return this.runGeneration(
      execution,
      organizationId,
      scope,
      projectContext,
      language,
    );
  }

  private async enqueueGeneration(
    organizationId: string,
    scope: AnalyticsScope,
    _projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const existingExecution =
      await this.analyticsExecutionRepository.findLatestByScope(
        scope,
        databaseSession,
      );
    if (
      existingExecution &&
      IN_FLIGHT_EXECUTION_STATUSES.has(existingExecution.status)
    ) {
      return existingExecution;
    }

    let execution: AnalyticsExecutionPersistenceRecord;
    try {
      execution = await this.analyticsExecutionRepository.create(
        {
          organizationId,
          projectId: scope.projectId,
          activityId: scope.activityId,
          scopeType: scope.type,
          language,
          status: "QUEUED",
          startedAt: null,
        },
        databaseSession,
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "analytics_generation_already_running"
      ) {
        const activeExecution =
          await this.analyticsExecutionRepository.findLatestByScope(
            scope,
            databaseSession,
          );
        if (
          activeExecution &&
          IN_FLIGHT_EXECUTION_STATUSES.has(activeExecution.status)
        ) {
          return activeExecution;
        }
      }

      throw error;
    }
    return execution;
  }

  async claimNextRunnableExecution(workerId: string) {
    const now = new Date();
    return this.analyticsExecutionRepository.claimNextRunnable(
      {
        workerId,
        leaseExpiresAt: new Date(
          now.getTime() + analyticsWorkerLeaseDurationMs,
        ),
        now,
        claimedStatus: "RUNNING",
      },
      databaseSession,
    );
  }

  async renewLease(executionId: string, workerId: string) {
    const now = new Date();
    const renewedExecution = await this.analyticsExecutionRepository.renewLease(
      {
        analyticsExecutionId: executionId,
        workerId,
        leaseExpiresAt: new Date(
          now.getTime() + analyticsWorkerLeaseDurationMs,
        ),
        heartbeatAt: now,
      },
      databaseSession,
    );

    if (!renewedExecution) {
      throw new AppError(
        "Analytics execution lease could not be renewed.",
        409,
        "analytics_execution_lease_not_owned",
      );
    }

    return renewedExecution;
  }

  async executeClaimedExecution(
    executionId: string,
    workerId: string,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    const execution = await this.analyticsExecutionRepository.findById(
      executionId,
      databaseSession,
    );

    if (!execution) {
      throw new AppError(
        "Analytics execution not found.",
        404,
        "analytics_execution_not_found",
      );
    }

    if (execution.status !== "RUNNING" || execution.leaseOwner !== workerId) {
      throw new AppError(
        "Analytics execution is not owned by this worker.",
        409,
        "analytics_execution_lease_not_owned",
      );
    }

    const project = await this.projectRepository.findById(
      execution.projectId,
      databaseSession,
    );
    if (!project) {
      return (
        (await this.analyticsExecutionRepository.update(
          execution.id,
          {
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "analytics_project_not_found",
            errorMessage:
              "The project required for this analytics execution no longer exists.",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
          },
          databaseSession,
        )) ?? execution
      );
    }

    const scope: AnalyticsScope = {
      type: execution.scopeType,
      projectId: execution.projectId,
      activityId: execution.activityId,
    };

    return this.runGeneration(
      execution,
      execution.organizationId,
      scope,
      buildProjectContextForCuration(project),
      execution.language,
    );
  }

  private async runGeneration(
    execution: AnalyticsExecutionPersistenceRecord,
    organizationId: string,
    scope: AnalyticsScope,
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    try {
      let {
        catalog,
        projectKnowledgeModelStatus,
        scopedInterpretationResultIds,
      } = await this.dashboardCatalogAssemblerService.assemble(scope);

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
        try {
          await this.projectKnowledgeBuilderService.buildForProject(
            scope.projectId,
          );
        } catch (error) {
          if (error instanceof ProjectKnowledgeModelBuildInProgressError) {
            return this.requeueWhileKnowledgeModelBuildRuns(execution);
          }
          throw error;
        }
        ({
          catalog,
          projectKnowledgeModelStatus,
          scopedInterpretationResultIds,
        } = await this.dashboardCatalogAssemblerService.assemble(scope));
      }

      if (projectKnowledgeModelStatus === "building") {
        return this.requeueWhileKnowledgeModelBuildRuns(execution);
      }

      const curationWithUsage =
        catalog.entries.length > 0
          ? await this.pythonAnalyticsCurationClient.curate(
              catalog,
              projectContext,
              language,
            )
          : { ...EMPTY_CATALOG_CURATION, llmUsage: null };
      const deterministicAnalyses =
        await this.deterministicAnalysisRepository.findByInterpretationResultIds(
          scopedInterpretationResultIds,
          databaseSession,
        );
      const initialDashboard = this.analyticsDashboardBuilderService.build({
        catalog,
        curation: curationWithUsage,
        deterministicAnalyses,
        projectContext,
      });
      const widgetCopyCandidates =
        this.analyticsDashboardBuilderService.buildWidgetCopyCandidates(
          initialDashboard,
        );
      const widgetCopyResponse =
        widgetCopyCandidates.length > 0
          ? await this.tryCurateWidgetCopy(
              widgetCopyCandidates,
              projectContext,
              language,
              scope.projectId,
            )
          : { widgets: [], llmUsage: null };
      await this.projectLlmTokenLedgerService.recordUsages(
        scope.projectId,
        [
          curationWithUsage.llmUsage ?? null,
          widgetCopyResponse.llmUsage ?? null,
        ],
        databaseSession,
      );
      const dashboard =
        this.analyticsDashboardBuilderService.applyWidgetCopySuggestions(
          initialDashboard,
          widgetCopyResponse.widgets,
        );

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
          curation: curationWithUsage,
          dashboard,
          dataQuality: {
            recordsExcludedCount: catalog.omittedEntries.length,
            warnings: uniqueWarnings([
              ...catalog.omittedEntries.map((entry) => entry.reason),
              ...catalog.qualitySignals.map((signal) => signal.message),
            ]),
          },
          limitations: uniqueWarnings([
            ...catalog.omittedEntries.map((entry) => entry.reason),
            ...catalog.qualitySignals.map((signal) => signal.message),
          ]),
          generatedAt: new Date(),
        },
        databaseSession,
      );

      const finalStatus: AnalyticsExecutionStatus =
        curationWithUsage.fellBackToSelectionOnly
          ? "COMPLETED_WITH_WARNINGS"
          : "COMPLETED";
      return (
        (await this.analyticsExecutionRepository.update(
          execution.id,
          {
            status: finalStatus,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
          },
          databaseSession,
        )) ?? execution
      );
    } catch (error) {
      await this.analyticsExecutionRepository.update(
        execution.id,
        {
          status: "FAILED",
          completedAt: new Date(),
          errorCode: "analytics_generation_failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unknown error while generating analytics.",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
        },
        databaseSession,
      );
      throw error;
    }
  }

  private async requeueWhileKnowledgeModelBuildRuns(
    execution: AnalyticsExecutionPersistenceRecord,
  ): Promise<AnalyticsExecutionPersistenceRecord> {
    return (
      (await this.analyticsExecutionRepository.update(
        execution.id,
        {
          status: "QUEUED",
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          nextAttemptAt: new Date(Date.now() + knowledgeModelRetryDelayMs),
        },
        databaseSession,
      )) ?? execution
    );
  }

  private async tryCurateWidgetCopy(
    widgetCopyCandidates: AnalyticsDashboardWidgetCopyCandidate[],
    projectContext: ProjectContextForCuration,
    language: "de" | "en",
    projectId: string,
  ) {
    try {
      return await this.pythonAnalyticsCurationClient.curateWidgetCopy(
        widgetCopyCandidates,
        projectContext,
        language,
      );
    } catch (error) {
      // Best-effort: the dashboard still renders with the deterministic
      // widget copy already built into `initialDashboard` if curation
      // fails, so this doesn't fail the whole generation — but a failure
      // here was previously silent, making a real outage in the Python
      // curation path invisible in production logs.
      this.logger.error(
        { projectId, widgetCandidateCount: widgetCopyCandidates.length, error },
        "Widget copy curation failed; falling back to uncurated widget copy.",
      );
      return { widgets: [], llmUsage: null };
    }
  }
}
