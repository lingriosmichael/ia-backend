import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type {
  ImpactCatalogItem,
  LlmUsageSummary,
  ProjectChartOpportunityAuditEntry,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryHeadlineKpi,
  ProjectImpactStoryNarrativeStatus,
  ProjectImpactStoryRecord,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityPersistenceRecord } from "../activity/activityPersistence.js";
import type { ActivityAnalysisRunV2Repository } from "../interpretation/activityAnalysisRunV2Repository.js";
import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type {
  PythonProcessingClient,
  ProjectImpactStoryNarrativeCatalogEntryRequest,
  ProjectImpactStoryNarrativeOutputFactRequest,
} from "../processing/pythonProcessingClient.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { OutcomeEvidenceLinkRepository } from "../outcome/outcomeEvidenceLinkRepository.js";
import type { ProjectOutcomeStatementRepository } from "../outcome/projectOutcomeStatementRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { normalizeMonthValue } from "../../shared/utils/monthValue.js";
import { buildProjectImpactStoryAssembly } from "./projectImpactStoryAssembly.js";
import { buildProjectChartOpportunityAudit } from "./projectChartOpportunityAudit.js";
import { buildProjectChartSelectionAudit } from "./projectChartSelectionAudit.js";
import {
  buildProjectImpactStoryCatalog,
  toProjectImpactStoryChartPlanRequestEntries,
  type ProjectImpactStoryCatalogEntry,
} from "./projectImpactStoryCatalog.js";
import { buildProjectImpactStoryContextCatalog } from "./projectImpactStoryContextCatalog.js";
import { buildProjectImpactStoryImpactCatalog } from "./projectImpactStoryImpactCatalog.js";
import { buildProjectImpactStoryGoalProgressEntries } from "./projectImpactStoryGoalProgress.js";
import { buildProjectImpactStoryChartBacklog } from "./projectImpactStoryChartBacklog.js";
import { buildProjectImpactStoryPairedStoryDeltaCatalog } from "./projectImpactStoryPairedStoryDeltaCatalog.js";
import {
  executeProjectImpactStoryChartPlan,
  PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES,
  PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT,
} from "./projectImpactStoryChartPlanExecution.js";
import { buildDeterministicFallbackChartPlan } from "./projectImpactStoryChartPlanFallback.js";
import { computeProjectImpactStoryStaleness } from "./projectImpactStoryStaleness.js";
import type { ProjectAnalyticsSnapshotRepository } from "./projectAnalyticsSnapshotRepository.js";
import type { ProjectAnalyticsSnapshotPersistenceRecord } from "./projectAnalyticsSnapshotPersistence.js";
import type { ProjectImpactStoryRepository } from "./projectImpactStoryRepository.js";
import type { ProjectImpactStoryPersistenceRecord } from "./projectImpactStoryPersistence.js";

function formatLatestTimestamp(
  snapshot: ProjectAnalyticsSnapshotPersistenceRecord,
  overlay: ProjectImpactStoryPersistenceRecord | null,
): string {
  const latestMillis = Math.max(
    snapshot.updatedAt.getTime(),
    overlay?.updatedAt.getTime() ?? 0,
  );
  return new Date(latestMillis).toISOString();
}

function composeProjectImpactStoryRecord(
  snapshot: ProjectAnalyticsSnapshotPersistenceRecord,
  overlay: ProjectImpactStoryPersistenceRecord | null,
): ProjectImpactStoryRecord {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    projectId: snapshot.projectId,
    status: snapshot.status,
    sourceSnapshot: snapshot.sourceSnapshot,
    activityCards: snapshot.activityCards,
    headlineKpis: snapshot.headlineKpis,
    chartPlan: snapshot.chartPlan,
    backlogChartPlan: snapshot.backlogChartPlan,
    contextCharts: snapshot.contextCharts,
    goalProgressEntries: snapshot.goalProgressEntries,
    impactCatalog: overlay?.impactCatalog ?? [],
    narrativeSummary: overlay?.narrativeSummary ?? null,
    narrativeStatus: overlay?.narrativeStatus ?? null,
    diagnostics: snapshot.diagnostics,
    llmUsage: mergeLlmUsage(snapshot.llmUsage, overlay?.llmUsage ?? null),
    errorMessage: snapshot.errorMessage ?? overlay?.errorMessage ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: formatLatestTimestamp(snapshot, overlay),
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
  initialSituation: string | null;
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

function formatFallbackDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// The emergency, non-LLM fallback for when the HTTP call to the Python
// narrative endpoint fails outright (network error, timeout, 5xx) — a
// different failure mode from Python's own within-service grounding-retry
// exhaustion (see narrative_grounding.py / ProjectImpactStoryNarrativeStatus
// "deterministic_fallback"), which already returns its own deterministic
// summary and never reaches this function. Deliberately built only from
// impactCatalog, mirroring narrative.py's own
// _build_deterministic_fallback_summary field-for-field, so this emergency
// path can never reintroduce the exact risk the impact-catalog restriction
// exists to close (writing outcome-sounding prose off reach/process data).
function buildImpactCatalogFallbackSentence(
  entry: ImpactCatalogItem,
  language: "de" | "en",
): string {
  if (entry.shape === "paired_delta") {
    if (language === "en") {
      return `For "${entry.outcomeStatement}", ${entry.nMatched} matched respondents moved from ${formatFallbackDecimal(entry.beforeValue)} to ${formatFallbackDecimal(entry.afterValue)} on "${entry.pairLabelDe}".`;
    }
    return `Für „${entry.outcomeStatement}“ veränderte sich bei ${entry.nMatched} zugeordneten Teilnehmenden „${entry.pairLabelDe}“ von ${formatFallbackDecimal(entry.beforeValue)} auf ${formatFallbackDecimal(entry.afterValue)}.`;
  }

  if (entry.shape === "single_distribution") {
    const sharesText = entry.shares
      .map((share) => `${share.labelDe}: ${share.count}`)
      .join(", ");
    if (language === "en") {
      return `For "${entry.outcomeStatement}", ${entry.n} responses to "${entry.questionLabelDe}": ${sharesText}.`;
    }
    return `Für „${entry.outcomeStatement}“ liegen zu „${entry.questionLabelDe}“ ${entry.n} Antworten vor: ${sharesText}.`;
  }

  if (language === "en") {
    return `"${entry.outcomeStatement}" is not yet measurable — no linked evidence yet.`;
  }
  return `„${entry.outcomeStatement}“ ist noch nicht messbar — es liegt noch keine verknüpfte Datengrundlage vor.`;
}

function buildImpactCatalogFallbackNarrativeSummary(
  impactCatalog: ImpactCatalogItem[],
  language: "de" | "en",
): string {
  return impactCatalog
    .map((entry) => buildImpactCatalogFallbackSentence(entry, language))
    .join(" ");
}

function toProjectImpactStoryNarrativeCatalogEntryRequests(
  impactCatalog: ImpactCatalogItem[],
): ProjectImpactStoryNarrativeCatalogEntryRequest[] {
  return impactCatalog.map((entry) => {
    if (entry.shape === "paired_delta") {
      return {
        entryId: entry.entryId,
        shape: "paired_delta",
        outcomeId: entry.outcomeId,
        outcomeTerm: entry.outcomeTerm,
        outcomeStatement: entry.outcomeStatement,
        pairLabel: entry.pairLabelDe,
        beforeValue: entry.beforeValue,
        afterValue: entry.afterValue,
        nMatched: entry.nMatched,
        nBaseline: entry.nBaseline,
      };
    }

    if (entry.shape === "single_distribution") {
      return {
        entryId: entry.entryId,
        shape: "single_distribution",
        outcomeId: entry.outcomeId,
        outcomeTerm: entry.outcomeTerm,
        outcomeStatement: entry.outcomeStatement,
        questionLabel: entry.questionLabelDe,
        shares: entry.shares.map((share) => ({
          label: share.labelDe,
          count: share.count,
        })),
        n: entry.n,
      };
    }

    return {
      entryId: entry.entryId,
      shape: "unmeasured",
      outcomeId: entry.outcomeId,
      outcomeTerm: entry.outcomeTerm,
      outcomeStatement: entry.outcomeStatement,
    };
  });
}

// "output-" prefixed so an output fact's entryId can never collide with an
// impactCatalog entryId in the same narrative request — the two lists come
// from independent id generators, and a collision would make a grounding
// violation impossible to trace back to the right source.
function toProjectImpactStoryNarrativeOutputFactRequests(
  headlineKpis: ProjectImpactStoryHeadlineKpi[],
): ProjectImpactStoryNarrativeOutputFactRequest[] {
  return headlineKpis.map((kpi) => ({
    entryId: `output-${kpi.kpiId}`,
    label: kpi.label,
    value: kpi.value,
    formatAs: kpi.formatAs,
    narrativeReason: kpi.narrativeReason,
  }));
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
    private readonly projectAnalyticsSnapshotRepository: ProjectAnalyticsSnapshotRepository,
    private readonly projectImpactStoryRepository: ProjectImpactStoryRepository,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly projectOutcomeStatementRepository: ProjectOutcomeStatementRepository,
    private readonly outcomeEvidenceLinkRepository: OutcomeEvidenceLinkRepository,
    private readonly currentActivityEvidenceLoader: CurrentActivityEvidenceLoader,
    private readonly activityAnalysisV2ToolExecutor: ActivityAnalysisV2ToolExecutor,
    // Only ever passed through to buildProjectImpactStoryPairedStoryDeltaCatalog
    // below, which has ignored all three (always returns `[]`) since
    // OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 6 removed the detection it relied
    // on. Kept here rather than trimmed, to avoid touching this already-large
    // constructor for a change with no behavior difference — see that file's
    // own comment for why the signature was kept.
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
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

    const catalog = buildProjectImpactStoryCatalog(
      normalizedActivities,
      activityAnalysisRuns,
      normalizedUploads,
      language,
    );
    if (assembly.activityCards.length === 0 && catalog.length === 0) {
      throw new AppError(
        "No activity in this project has chartable analysis evidence yet.",
        409,
        "project_impact_story_no_grounded_indicators",
      );
    }

    // Fallback-only deterministic descriptive charts. The primary planner
    // catalog already includes descriptive distributions; this helper only
    // survives so the analytics page can still show something if the chart
    // planner returns no selected charts.
    const fallbackContextCharts = buildProjectImpactStoryContextCatalog(
      normalizedActivities,
      activityAnalysisRuns,
      normalizedUploads,
    );

    // The only catalog the narrative call is allowed to see — built only
    // from human-confirmed OutcomeEvidenceLink records, entirely separate
    // from `catalog`/`contextCharts` above. See
    // IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §4.5/§4.6.
    const outcomeStatements =
      await this.projectOutcomeStatementRepository.listByProjectId(
        project.id,
        databaseSession,
      );
    const confirmedLinks =
      await this.outcomeEvidenceLinkRepository.listByProjectId(
        project.id,
        databaseSession,
      );

    // Both assembly's activitiesWithNoGroundedIndicators and
    // buildProjectChartOpportunityAudit's "no current analysis run" entries
    // below only track each activity's own ActivityAnalystV2 goal
    // indicators — neither has any idea a zero-goal activity (e.g.
    // Ausgangslage/Wirkungsdaten, whose only role is supplying the
    // before/after columns a paired_delta OutcomeEvidenceLink measures)
    // can still be squarely in use via this completely different data
    // source, loaded here. Without this, an activity directly powering the
    // narrative one card up still showed up as "not yet analyzed" in both
    // the narrative banner's footnote and the Diagnose panel.
    const activityIdsWithConfirmedOutcomeEvidence = new Set(
      confirmedLinks.flatMap((link) =>
        link.shape === "paired_delta"
          ? [link.activityIdBefore, link.activityIdAfter]
          : [link.activityId],
      ),
    );
    const activityIdByName = new Map(
      normalizedActivities.map((activity) => [activity.name, activity.id]),
    );
    assembly.diagnostics.activitiesWithNoGroundedIndicators =
      assembly.diagnostics.activitiesWithNoGroundedIndicators.filter(
        (activityName) => {
          const activityId = activityIdByName.get(activityName);
          return (
            activityId === undefined ||
            !activityIdsWithConfirmedOutcomeEvidence.has(activityId)
          );
        },
      );

    const impactCatalog = await buildProjectImpactStoryImpactCatalog(
      {
        currentActivityEvidenceLoader: this.currentActivityEvidenceLoader,
        activityAnalysisV2ToolExecutor: this.activityAnalysisV2ToolExecutor,
        logger: this.logger,
      },
      outcomeStatements,
      confirmedLinks,
    );

    // Exploratory before/after story evidence — declared-pairing metadata
    // only, reusing the same detection/measurement the confirmed impact
    // catalog above uses, but across every activity (not just the two
    // system activities) and excluding any pair already confirmed there.
    // See projectImpactStoryPairedStoryDeltaCatalog.ts.
    const pairedStoryDeltaCatalog =
      await buildProjectImpactStoryPairedStoryDeltaCatalog(
        {
          outcomeEvidencePairingEvidenceLoaderDependencies: {
            activityRepository: this.activityRepository,
            uploadMetadataRepository: this.uploadMetadataRepository,
            interpretationResultRepository: this.interpretationResultRepository,
            datasetPreparationRepository: this.datasetPreparationRepository,
            privacySafeRepresentationRepository:
              this.privacySafeRepresentationRepository,
          },
          currentActivityEvidenceLoader: this.currentActivityEvidenceLoader,
          activityAnalysisV2ToolExecutor: this.activityAnalysisV2ToolExecutor,
          logger: this.logger,
        },
        project.id,
        normalizedActivities,
        confirmedLinks,
      );
    const fullCatalog = [...catalog, ...pairedStoryDeltaCatalog];

    // Deterministic — always computed, never subject to chart-plan
    // selection. See projectImpactStoryGoalProgress.ts.
    const goalProgressEntries =
      buildProjectImpactStoryGoalProgressEntries(fullCatalog);

    // Deterministic (no LLM) audit of every chart-worthy fact this run
    // could support — computed here, from the exact same catalog data
    // just assembled above, so its entryIds line up 1:1 with `fullCatalog`
    // and its ready_now set reflects precisely this generation's
    // candidate pool, not a later recomputation against since-changed
    // data.
    const chartOpportunityAudit = [
      ...buildProjectChartOpportunityAudit(
        normalizedActivities,
        activityAnalysisRuns,
        normalizedUploads,
        activityIdsWithConfirmedOutcomeEvidence,
      ),
      ...pairedStoryDeltaCatalog.map(
        (entry): ProjectChartOpportunityAuditEntry => ({
          entryId: entry.entryId,
          kind: "paired_story_delta",
          activityId: entry.activityId,
          activityName: entry.activityName,
          title: entry.pairLabelDe,
          sourceTables: [],
          status: "ready_now",
          reasonCode: "materialized_paired_story_delta",
          reasonDetail: `Exploratory before/after evidence, not confirmed outcome measurement (n=${entry.nMatched} matched).`,
        }),
      ),
    ];

    return {
      project: project as ProjectImpactStoryProjectContext,
      activities,
      activityAnalysisRuns,
      assembly,
      catalog: fullCatalog,
      contextCharts: fallbackContextCharts,
      impactCatalog,
      goalProgressEntries,
      chartOpportunityAudit,
    };
  }

  private async generateNarrative(
    project: ProjectImpactStoryProjectContext,
    impactCatalog: ImpactCatalogItem[],
    headlineKpis: ProjectImpactStoryHeadlineKpi[],
    language: "de" | "en",
  ): Promise<{
    narrativeSummary: string;
    narrativeStatus: ProjectImpactStoryNarrativeStatus;
    llmUsage: LlmUsageSummary | null;
  }> {
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
        initialSituation: project.initialSituation,
        outputFacts:
          toProjectImpactStoryNarrativeOutputFactRequests(headlineKpis),
        catalog:
          toProjectImpactStoryNarrativeCatalogEntryRequests(impactCatalog),
      });

    const llmUsage = response.llmUsage ?? null;
    await this.projectLlmTokenLedgerService.recordUsage(
      project.id,
      llmUsage,
      databaseSession,
    );

    const narrativeStatus: ProjectImpactStoryNarrativeStatus =
      response.groundingStatus === "PASSED"
        ? "generated"
        : response.fellBackToDeterministicSummary
          ? "deterministic_fallback"
          : "generated_unverified";

    // The one place a grounding-exhaustion fallback becomes visible at
    // all: Python's HTTP call succeeds (200) either way, so nothing here
    // throws and the catch block in buildProjectImpactStory never sees
    // this case — without this log, "the narrative silently fell back to
    // the template" was previously undiagnosable from ia_backend's side.
    const logFields = {
      projectId: project.id,
      impactCatalogCount: impactCatalog.length,
      outputFactCount: headlineKpis.length,
      groundingStatus: response.groundingStatus,
      groundingRetryCount: response.groundingRetryCount,
      narrativeLength: response.narrativeSummary.length,
      llmTotalTokens: llmUsage?.totalTokens ?? 0,
      llmTotalCalls: llmUsage?.totalCalls ?? 0,
    };
    if (narrativeStatus === "generated") {
      this.logger.info(logFields, "project impact story narrative generated");
    } else if (narrativeStatus === "generated_unverified") {
      this.logger.warn(
        { ...logFields, narrativeStatus },
        "project impact story narrative used the model's last attempt unverified: grounding never passed",
      );
    } else {
      this.logger.warn(
        { ...logFields, narrativeStatus },
        "project impact story narrative fell back to deterministic template: grounding never passed",
      );
    }

    return {
      narrativeSummary: response.narrativeSummary,
      narrativeStatus,
      llmUsage,
    };
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
    hasGoalProgressChart: boolean,
  ): Promise<{
    headlineKpis: ProjectImpactStoryHeadlineKpi[];
    chartPlan: ProjectImpactStoryChartSpec[];
    selectedEntryIds: string[];
    llmUsage: LlmUsageSummary | null;
  }> {
    if (catalog.length === 0) {
      this.logger.info(
        { projectId: project.id },
        "project impact story chart plan skipped: no catalog candidates",
      );
      return {
        headlineKpis: [],
        chartPlan: [],
        selectedEntryIds: [],
        llmUsage: null,
      };
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

      const executed = executeProjectImpactStoryChartPlan(
        catalog,
        response,
        language,
        hasGoalProgressChart,
      );
      const llmUsage = response.llmUsage ?? null;
      await this.projectLlmTokenLedgerService.recordUsage(
        project.id,
        llmUsage,
        databaseSession,
      );

      // fellBackToDeterministicSelection was previously parsed off the
      // Python response and then discarded everywhere — the same class of
      // silent-fallback gap generateNarrative had, just without a status
      // field on the record to hide behind. Logged here since there's no
      // persisted field for it to surface through instead.
      const logFields = {
        projectId: project.id,
        catalogCandidateCount: catalog.length,
        groundingStatus: response.groundingStatus,
        fellBackToDeterministicSelection:
          response.fellBackToDeterministicSelection,
        headlineKpiCount: executed.headlineKpis.length,
        chartCount: executed.chartPlan.length,
        droppedKpiCount: executed.droppedKpiCount,
        droppedChartCount: executed.droppedChartCount,
        selectedEntryCount: executed.selectedEntryIds.length,
        llmTotalTokens: llmUsage?.totalTokens ?? 0,
        llmTotalCalls: llmUsage?.totalCalls ?? 0,
      };
      if (response.fellBackToDeterministicSelection) {
        this.logger.warn(
          logFields,
          "project impact story chart plan fell back to deterministic selection: grounding never passed",
        );
      } else {
        this.logger.info(
          logFields,
          "project impact story chart plan generated",
        );
      }

      return {
        headlineKpis: executed.headlineKpis,
        chartPlan: executed.chartPlan,
        selectedEntryIds: executed.selectedEntryIds,
        llmUsage,
      };
    } catch (error) {
      this.logger.error(
        {
          err: error,
          projectId: project.id,
          catalogCandidateCount: catalog.length,
        },
        "project impact story chart plan failed; using deterministic fallback KPIs",
      );

      const fallback = buildDeterministicFallbackChartPlan(catalog, language);
      return {
        headlineKpis: fallback.headlineKpis,
        chartPlan: [],
        selectedEntryIds: [],
        llmUsage: null,
      };
    }
  }

  async buildProjectImpactStory(
    userId: string,
    projectId: string,
    language: "de" | "en",
  ): Promise<ProjectImpactStoryRecord> {
    const startedAt = Date.now();
    this.logger.info(
      { projectId, language },
      "project impact story generation started",
    );

    const {
      project,
      assembly,
      catalog,
      contextCharts,
      impactCatalog,
      goalProgressEntries,
      chartOpportunityAudit,
    } = await this.assertReadyForImpactStoryRun(userId, projectId, language);

    const impactCatalogByShape = impactCatalog.reduce<Record<string, number>>(
      (counts, entry) => {
        counts[entry.shape] = (counts[entry.shape] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const chartOpportunityByStatus = chartOpportunityAudit.reduce<
      Record<string, number>
    >((counts, entry) => {
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      return counts;
    }, {});
    this.logger.info(
      {
        projectId,
        activityCount: assembly.activityCards.length,
        chartPlanCatalogCandidateCount: catalog.length,
        contextChartCandidateCount: contextCharts.length,
        impactCatalogCount: impactCatalog.length,
        impactCatalogByShape,
        goalProgressEntryCount: goalProgressEntries.length,
        chartOpportunityByStatus,
      },
      "project impact story catalog assembled",
    );

    // Every exit point below composes and persists a record with a
    // different shape (no impact catalog at all; narrative generated;
    // narrative fell back after an exception) — logged once here rather
    // than duplicated at each return so "what did this run actually
    // produce" always gets logged regardless of which path it took.
    const logCompletion = (record: ProjectImpactStoryRecord) => {
      this.logger.info(
        {
          projectId,
          durationMs: Date.now() - startedAt,
          chartCount: record.chartPlan.length,
          backlogChartCount: record.backlogChartPlan.length,
          headlineKpiCount: record.headlineKpis.length,
          contextChartCount: record.contextCharts.length,
          impactCatalogCount: record.impactCatalog.length,
          goalProgressEntryCount: record.goalProgressEntries.length,
          narrativeStatus: record.narrativeStatus,
          llmTotalTokens: record.llmUsage?.totalTokens ?? 0,
        },
        "project impact story generation completed",
      );
      return record;
    };

    const chartPlanResult = await this.planChartsAndKpis(
      project,
      catalog,
      language,
      goalProgressEntries.length > 0,
    );

    const fallbackContextCharts =
      chartPlanResult.chartPlan.length === 0 ? contextCharts : [];

    const backlogChartPlan = buildProjectImpactStoryChartBacklog(
      catalog,
      new Set(chartPlanResult.selectedEntryIds),
      language,
    );

    // Computed from this exact generation's own opportunity audit and
    // selectedEntryIds — never a later recomputation against
    // since-changed data, so the diff stays true to what this run actually
    // saw and chose. See projectChartSelectionAudit.ts.
    const chartSelectionAudit = buildProjectChartSelectionAudit(
      chartOpportunityAudit,
      chartPlanResult.selectedEntryIds,
    );

    const snapshot = await this.projectAnalyticsSnapshotRepository.create(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        status: "completed",
        sourceSnapshot: assembly.sourceSnapshot,
        activityCards: assembly.activityCards,
        headlineKpis: chartPlanResult.headlineKpis,
        chartPlan: chartPlanResult.chartPlan,
        backlogChartPlan,
        contextCharts: fallbackContextCharts,
        goalProgressEntries,
        diagnostics: {
          ...assembly.diagnostics,
          chartOpportunityAudit,
          chartSelectionAudit,
        },
        llmUsage: chartPlanResult.llmUsage,
        errorMessage: null,
      },
      databaseSession,
    );

    const overlayPersistenceInput = {
      organizationId: project.organizationId,
      projectId: project.id,
      analyticsSnapshotId: snapshot.id,
      impactCatalog,
    };

    if (impactCatalog.length === 0) {
      return logCompletion(composeProjectImpactStoryRecord(snapshot, null));
    }

    try {
      const narrative = await this.generateNarrative(
        project,
        impactCatalog,
        chartPlanResult.headlineKpis,
        language,
      );

      const story = await this.projectImpactStoryRepository.create(
        {
          ...overlayPersistenceInput,
          status: "completed",
          narrativeSummary: narrative.narrativeSummary,
          narrativeStatus: narrative.narrativeStatus,
          llmUsage: narrative.llmUsage,
          errorMessage: null,
        },
        databaseSession,
      );
      return logCompletion(composeProjectImpactStoryRecord(snapshot, story));
    } catch (error) {
      this.logger.error(
        { err: error, projectId: project.id },
        "project impact story narrative generation failed; using deterministic fallback narrative",
      );

      const story = await this.projectImpactStoryRepository.create(
        {
          ...overlayPersistenceInput,
          status: "completed",
          narrativeSummary: buildImpactCatalogFallbackNarrativeSummary(
            impactCatalog,
            language,
          ),
          narrativeStatus: "call_failed",
          llmUsage: null,
          errorMessage:
            error instanceof Error ? error.message : "Unknown error.",
        },
        databaseSession,
      );
      return logCompletion(composeProjectImpactStoryRecord(snapshot, story));
    }
  }

  async assertReadyForProjectAnalyticsRun(
    userId: string,
    projectId: string,
    language: "de" | "en",
  ) {
    return this.assertReadyForImpactStoryRun(userId, projectId, language);
  }

  async buildProjectAnalytics(
    userId: string,
    projectId: string,
    language: "de" | "en",
  ): Promise<ProjectImpactStoryRecord> {
    return this.buildProjectImpactStory(userId, projectId, language);
  }

  async getLatestProjectAnalytics(
    userId: string,
    projectId: string,
  ): Promise<{
    story: ProjectImpactStoryRecord | null;
    isStale: boolean;
  }> {
    return this.getLatestForProject(userId, projectId);
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

    const snapshot =
      await this.projectAnalyticsSnapshotRepository.findLatestByProjectId(
        project.id,
        databaseSession,
      );

    if (!snapshot) {
      return { story: null, isStale: false };
    }

    const overlay =
      await this.projectImpactStoryRepository.findLatestByProjectId(
        project.id,
        databaseSession,
      );
    const matchingOverlay =
      overlay?.analyticsSnapshotId === snapshot.id ? overlay : null;
    const confirmedLinks =
      await this.outcomeEvidenceLinkRepository.listByProjectId(
        project.id,
        databaseSession,
      );

    const { activities, activityAnalysisRuns } = await loadProjectContext(
      this.activityRepository,
      this.uploadMetadataRepository,
      this.activityAnalysisRunV2Repository,
      project.id,
    );

    const { isStale } = computeProjectImpactStoryStaleness(
      snapshot,
      activities,
      activityAnalysisRuns,
      confirmedLinks,
      matchingOverlay,
    );

    return {
      story: composeProjectImpactStoryRecord(snapshot, matchingOverlay),
      isStale,
    };
  }
}
