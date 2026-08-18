import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type {
  LlmUsageSummary,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryHeadlineKpi,
  ProjectImpactStoryRecord,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityPersistenceRecord } from "../activity/activityPersistence.js";
import type { ActivityAnalysisRunV2Repository } from "../interpretation/activityAnalysisRunV2Repository.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import { normalizeMonthValue } from "../../shared/utils/monthValue.js";
import { buildProjectImpactStoryAssembly } from "./projectImpactStoryAssembly.js";
import {
  buildProjectImpactStoryCatalog,
  toProjectImpactStoryChartPlanRequestEntries,
  type ProjectImpactStoryCatalogEntry,
} from "./projectImpactStoryCatalog.js";
import {
  executeProjectImpactStoryChartPlan,
  PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES,
  PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT,
} from "./projectImpactStoryChartPlanExecution.js";
import { buildDeterministicFallbackChartPlan } from "./projectImpactStoryChartPlanFallback.js";
import { computeProjectImpactStoryStaleness } from "./projectImpactStoryStaleness.js";
import type { ProjectImpactStoryRepository } from "./projectImpactStoryRepository.js";
import type { ProjectImpactStoryPersistenceRecord } from "./projectImpactStoryPersistence.js";

function mapProjectImpactStoryRecord(
  story: ProjectImpactStoryPersistenceRecord,
): ProjectImpactStoryRecord {
  return {
    id: story.id,
    organizationId: story.organizationId,
    projectId: story.projectId,
    status: story.status,
    sourceSnapshot: story.sourceSnapshot,
    activityCards: story.activityCards,
    headlineKpis: story.headlineKpis,
    chartPlan: story.chartPlan,
    narrativeSummary: story.narrativeSummary,
    diagnostics: story.diagnostics,
    llmUsage: story.llmUsage,
    errorMessage: story.errorMessage,
    createdAt: story.createdAt.toISOString(),
    updatedAt: story.updatedAt.toISOString(),
  };
}

interface ProjectImpactStoryProjectContext {
  id: string;
  organizationId: string;
  name: string;
  startMonth: string | null;
  endMonth: string | null;
  targetGroups: string[];
  overarchingTargetGroup: string | null;
  areaOfOperation: string | null;
}

function mergeLlmUsage(
  first: LlmUsageSummary | null,
  second: LlmUsageSummary | null,
): LlmUsageSummary | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return {
    totalCalls: first.totalCalls + second.totalCalls,
    totalPromptTokens: first.totalPromptTokens + second.totalPromptTokens,
    totalCompletionTokens:
      first.totalCompletionTokens + second.totalCompletionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    calls: [...first.calls, ...second.calls],
  };
}

function formatFallbackTileValue(value: number, formatAs: string) {
  if (formatAs === "percentage") {
    return `${Math.round(value * 100)}%`;
  }

  return new Intl.NumberFormat("de-DE").format(value);
}

function buildFallbackNarrativeSummary(
  projectName: string,
  assembly: ReturnType<typeof buildProjectImpactStoryAssembly>,
  language: "de" | "en",
) {
  const activityCount = assembly.activityCards.length;
  const tileCount = assembly.activityCards.reduce(
    (count, activity) => count + activity.tiles.length,
    0,
  );
  const highlights = assembly.narrativeInput
    .flatMap((activity) =>
      activity.tiles.slice(0, 2).map((tile) => {
        const value = formatFallbackTileValue(tile.value, tile.formatAs);
        return `${activity.activityName}: ${tile.label} ${value}`;
      }),
    )
    .slice(0, 3);

  if (language === "en") {
    const highlightSentence =
      highlights.length > 0 ? ` Key signals: ${highlights.join("; ")}.` : "";
    return `The impact story for ${projectName} summarizes ${activityCount} activities with ${tileCount} grounded indicator tiles.${highlightSentence} The detailed activity cards below show the computed evidence currently available.`;
  }

  const highlightSentence =
    highlights.length > 0 ? ` Zentrale Signale: ${highlights.join("; ")}.` : "";
  return `Die Wirkungsgeschichte für ${projectName} fasst ${activityCount} Aktivitäten mit ${tileCount} belegten Kennzahlen zusammen.${highlightSentence} Die Detailkarten unten zeigen die aktuell berechnete Evidenz.`;
}

function formatNarrativeMonth(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const compactMonthYearMatch = /^(\d{2})(\d{4})$/.exec(value);
  if (compactMonthYearMatch) {
    return `${compactMonthYearMatch[2]}-${compactMonthYearMatch[1]}`;
  }

  return normalizeMonthValue(value);
}

function buildNarrativePeriod(
  startMonth: string | null,
  endMonth: string | null,
): string | null {
  const normalizedStart = formatNarrativeMonth(startMonth);
  const normalizedEnd = formatNarrativeMonth(endMonth);

  if (!normalizedStart && !normalizedEnd) {
    return null;
  }

  if (normalizedStart && normalizedEnd) {
    return normalizedStart === normalizedEnd
      ? normalizedStart
      : `${normalizedStart} bis ${normalizedEnd}`;
  }

  return normalizedStart ?? normalizedEnd;
}

async function loadProjectContext(
  activityRepository: ActivityRepository,
  uploadMetadataRepository: UploadMetadataRepository,
  activityAnalysisRunV2Repository: ActivityAnalysisRunV2Repository,
  projectId: string,
): Promise<{
  activities: ActivityPersistenceRecord[];
  uploads: UploadMetadataPersistenceRecord[];
  activityAnalysisRuns: ActivityAnalysisRunV2PersistenceRecord[];
}> {
  const activities = await activityRepository.listByProject(
    projectId,
    databaseSession,
  );
  const uploads = await uploadMetadataRepository.listByActivityIds(
    activities.map((activity) => activity.id),
    databaseSession,
  );
  // One query per activity rather than a single project-wide listByProjectId
  // call, deliberately: listByProjectId is capped by a flat limit sorted
  // globally by createdAt, so an activity that hasn't been rerun recently
  // could have its only completed run pushed past that limit by other
  // activities' more-recent reruns. findLatestCompletedByActivityId gets
  // the right document for every activity regardless of how recently its
  // siblings were rerun.
  const activityAnalysisRuns = (
    await Promise.all(
      activities.map((activity) =>
        activityAnalysisRunV2Repository.findLatestCompletedByActivityId(
          activity.id,
          databaseSession,
        ),
      ),
    )
  ).filter(
    (run): run is ActivityAnalysisRunV2PersistenceRecord => run !== null,
  );

  return { activities, uploads, activityAnalysisRuns };
}

export class ProjectImpactStoryService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly activityAnalysisRunV2Repository: ActivityAnalysisRunV2Repository,
    private readonly projectImpactStoryRepository: ProjectImpactStoryRepository,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Called both as a fast pre-check before job creation (so a doomed run
  // never gets queued) and again defensively at the top of
  // buildProjectImpactStory (state can drift between enqueue and claim,
  // e.g. every activity's evidence gets deleted while the job is queued) —
  // same two-call-site reasoning as ActivityAnalysisV2Service's
  // assertReadyForV2Run.
  async assertReadyForImpactStoryRun(
    userId: string,
    projectId: string,
    language: "de" | "en",
  ) {
    const { project } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    const { activities, uploads, activityAnalysisRuns } =
      await loadProjectContext(
        this.activityRepository,
        this.uploadMetadataRepository,
        this.activityAnalysisRunV2Repository,
        project.id,
      );

    if (activities.length === 0) {
      throw new AppError(
        "This project has no activities yet.",
        409,
        "project_impact_story_no_activities",
      );
    }

    const normalizedActivities = activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
    }));
    const normalizedUploads = uploads
      .filter((upload) => upload.activityId !== null)
      .map((upload) => ({
        id: upload.id,
        activityId: upload.activityId as string,
      }));

    const assembly = buildProjectImpactStoryAssembly({
      activities: normalizedActivities,
      activityAnalysisRuns,
      uploads: normalizedUploads,
      language,
    });

    if (assembly.activityCards.length === 0) {
      throw new AppError(
        "No activity in this project has a grounded, quantitative indicator yet.",
        409,
        "project_impact_story_no_grounded_indicators",
      );
    }

    const catalog = buildProjectImpactStoryCatalog(
      normalizedActivities,
      activityAnalysisRuns,
      normalizedUploads,
      language,
    );

    return {
      project: project as ProjectImpactStoryProjectContext,
      activities,
      activityAnalysisRuns,
      assembly,
      catalog,
    };
  }

  private async generateNarrative(
    project: ProjectImpactStoryProjectContext,
    assembly: ReturnType<typeof buildProjectImpactStoryAssembly>,
    language: "de" | "en",
  ): Promise<{ narrativeSummary: string; llmUsage: LlmUsageSummary | null }> {
    const response =
      await this.pythonProcessingClient.generateProjectImpactStoryNarrative({
        projectId: project.id,
        projectName: project.name,
        language,
        projectPeriod: buildNarrativePeriod(
          project.startMonth,
          project.endMonth,
        ),
        targetGroup:
          project.overarchingTargetGroup ??
          project.targetGroups.find((group) => group.trim().length > 0) ??
          null,
        region: project.areaOfOperation,
        activityCards: assembly.narrativeInput.map((activity) => ({
          activityId: activity.activityId,
          activityName: activity.activityName,
          tiles: activity.tiles,
        })),
      });

    const llmUsage = response.llmUsage ?? null;
    await this.projectLlmTokenLedgerService.recordUsage(
      project.id,
      llmUsage,
      databaseSession,
    );

    return { narrativeSummary: response.narrativeSummary, llmUsage };
  }

  // Never throws — a chart-plan failure must not prevent the rest of the
  // story (activity cards, narrative) from persisting. Mirrors
  // generateNarrative's own try/catch fallback in buildProjectImpactStory,
  // but self-contained here since chart-plan failure and narrative failure
  // are independent and shouldn't block each other.
  private async planChartsAndKpis(
    project: ProjectImpactStoryProjectContext,
    catalog: ProjectImpactStoryCatalogEntry[],
    language: "de" | "en",
  ): Promise<{
    headlineKpis: ProjectImpactStoryHeadlineKpi[];
    chartPlan: ProjectImpactStoryChartSpec[];
    llmUsage: LlmUsageSummary | null;
  }> {
    if (catalog.length === 0) {
      return { headlineKpis: [], chartPlan: [], llmUsage: null };
    }

    try {
      const response =
        await this.pythonProcessingClient.planProjectImpactStoryChart({
          projectId: project.id,
          projectName: project.name,
          language,
          catalog: toProjectImpactStoryChartPlanRequestEntries(catalog),
          allowedChartTypes: PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES,
          headlineKpiCount: PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT,
        });

      const executed = executeProjectImpactStoryChartPlan(catalog, response);
      const llmUsage = response.llmUsage ?? null;
      await this.projectLlmTokenLedgerService.recordUsage(
        project.id,
        llmUsage,
        databaseSession,
      );

      return {
        headlineKpis: executed.headlineKpis,
        chartPlan: executed.chartPlan,
        llmUsage,
      };
    } catch (error) {
      this.logger.error(
        { err: error, projectId: project.id },
        "project impact story chart plan failed; using deterministic fallback KPIs",
      );

      const fallback = buildDeterministicFallbackChartPlan(catalog);
      return {
        headlineKpis: fallback.headlineKpis,
        chartPlan: [],
        llmUsage: null,
      };
    }
  }

  async buildProjectImpactStory(
    userId: string,
    projectId: string,
    language: "de" | "en",
  ): Promise<ProjectImpactStoryRecord> {
    const { project, assembly, catalog } =
      await this.assertReadyForImpactStoryRun(userId, projectId, language);

    const chartPlanResult = await this.planChartsAndKpis(
      project,
      catalog,
      language,
    );

    const basePersistenceInput = {
      organizationId: project.organizationId,
      projectId: project.id,
      sourceSnapshot: assembly.sourceSnapshot,
      activityCards: assembly.activityCards,
      headlineKpis: chartPlanResult.headlineKpis,
      chartPlan: chartPlanResult.chartPlan,
      diagnostics: assembly.diagnostics,
    };

    try {
      const narrative = await this.generateNarrative(
        project,
        assembly,
        language,
      );

      const story = await this.projectImpactStoryRepository.create(
        {
          ...basePersistenceInput,
          status: "completed",
          narrativeSummary: narrative.narrativeSummary,
          llmUsage: mergeLlmUsage(narrative.llmUsage, chartPlanResult.llmUsage),
          errorMessage: null,
        },
        databaseSession,
      );
      return mapProjectImpactStoryRecord(story);
    } catch (error) {
      this.logger.error(
        { err: error, projectId: project.id },
        "project impact story narrative generation failed; using deterministic fallback narrative",
      );

      const story = await this.projectImpactStoryRepository.create(
        {
          ...basePersistenceInput,
          status: "completed",
          narrativeSummary: buildFallbackNarrativeSummary(
            project.name,
            assembly,
            language,
          ),
          llmUsage: chartPlanResult.llmUsage,
          errorMessage:
            error instanceof Error ? error.message : "Unknown error.",
        },
        databaseSession,
      );
      return mapProjectImpactStoryRecord(story);
    }
  }

  async getLatestForProject(
    userId: string,
    projectId: string,
  ): Promise<{
    story: ProjectImpactStoryRecord | null;
    isStale: boolean;
  }> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const story = await this.projectImpactStoryRepository.findLatestByProjectId(
      project.id,
      databaseSession,
    );

    if (!story) {
      return { story: null, isStale: false };
    }

    const { activities, activityAnalysisRuns } = await loadProjectContext(
      this.activityRepository,
      this.uploadMetadataRepository,
      this.activityAnalysisRunV2Repository,
      project.id,
    );

    const { isStale } = computeProjectImpactStoryStaleness(
      story,
      activities,
      activityAnalysisRuns,
    );

    return { story: mapProjectImpactStoryRecord(story), isStale };
  }
}
