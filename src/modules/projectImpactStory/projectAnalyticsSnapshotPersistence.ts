import type {
  ActivityImpactStoryCard,
  LlmUsageSummary,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryDiagnostics,
  ProjectImpactStoryGoalProgressEntry,
  ProjectImpactStoryHeadlineKpi,
  ProjectImpactStorySourceSnapshotItem,
  ProjectImpactStoryStatus,
} from "../../shared/contracts.js";

export interface ProjectAnalyticsSnapshotPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  status: ProjectImpactStoryStatus;
  sourceSnapshot: ProjectImpactStorySourceSnapshotItem[];
  activityCards: ActivityImpactStoryCard[];
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  backlogChartPlan: ProjectImpactStoryChartSpec[];
  goalProgressEntries: ProjectImpactStoryGoalProgressEntry[];
  confirmedOutcomeCharts: ProjectImpactStoryChartSpec[];
  diagnostics: ProjectImpactStoryDiagnostics;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAnalyticsSnapshotCreateInput {
  organizationId: string;
  projectId: string;
  status: ProjectImpactStoryStatus;
  sourceSnapshot: ProjectImpactStorySourceSnapshotItem[];
  activityCards: ActivityImpactStoryCard[];
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  backlogChartPlan: ProjectImpactStoryChartSpec[];
  goalProgressEntries: ProjectImpactStoryGoalProgressEntry[];
  confirmedOutcomeCharts: ProjectImpactStoryChartSpec[];
  diagnostics: ProjectImpactStoryDiagnostics;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
}
