import type {
  AnalyticsDataQuality,
  AnalyticsScopeType,
  DashboardCuration,
  EvidenceCatalog,
} from "./analyticsContracts.js";

export interface AnalyticsResultPersistenceRecord {
  id: string;
  analyticsExecutionId: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  catalogVersion: string;
  knowledgeModelVersion: number;
  catalog: EvidenceCatalog;
  curation: DashboardCuration;
  dataQuality: AnalyticsDataQuality;
  limitations: string[];
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsResultCreateInput {
  analyticsExecutionId: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  catalogVersion: string;
  knowledgeModelVersion: number;
  catalog: EvidenceCatalog;
  curation: DashboardCuration;
  dataQuality: AnalyticsDataQuality;
  limitations: string[];
  generatedAt: Date;
}
