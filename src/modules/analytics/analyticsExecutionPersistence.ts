import type {
  AnalyticsExecutionStatus,
  AnalyticsScopeType,
} from "./analyticsContracts.js";

export interface AnalyticsExecutionPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  status: AnalyticsExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsExecutionCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  status: AnalyticsExecutionStatus;
  startedAt: Date | null;
}

export interface AnalyticsExecutionStatusUpdate {
  status: AnalyticsExecutionStatus;
  completedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}
