import type {
  ActivityImpactStoryCard,
  ContextCatalogEntry,
  LlmUsageSummary,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryDiagnostics,
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
  contextCharts: ContextCatalogEntry[];
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
  contextCharts: ContextCatalogEntry[];
  diagnostics: ProjectImpactStoryDiagnostics;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
}
