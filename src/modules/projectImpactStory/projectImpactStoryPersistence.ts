import type {
  ActivityImpactStoryCard,
  LlmUsageSummary,
  ProjectImpactStoryChartSpec,
  ProjectImpactStoryDiagnostics,
  ProjectImpactStoryHeadlineKpi,
  ProjectImpactStorySourceSnapshotItem,
  ProjectImpactStoryStatus,
} from "../../shared/contracts.js";

export interface ProjectImpactStoryPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  status: ProjectImpactStoryStatus;
  sourceSnapshot: ProjectImpactStorySourceSnapshotItem[];
  activityCards: ActivityImpactStoryCard[];
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  narrativeSummary: string | null;
  diagnostics: ProjectImpactStoryDiagnostics;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectImpactStoryCreateInput {
  organizationId: string;
  projectId: string;
  status: ProjectImpactStoryStatus;
  sourceSnapshot: ProjectImpactStorySourceSnapshotItem[];
  activityCards: ActivityImpactStoryCard[];
  headlineKpis: ProjectImpactStoryHeadlineKpi[];
  chartPlan: ProjectImpactStoryChartSpec[];
  narrativeSummary: string | null;
  diagnostics: ProjectImpactStoryDiagnostics;
  llmUsage: LlmUsageSummary | null;
  errorMessage: string | null;
}
