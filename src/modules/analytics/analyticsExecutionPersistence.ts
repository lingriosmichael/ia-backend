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
  language: "de" | "en";
  status: AnalyticsExecutionStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  maxAttempts: number;
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
  language: "de" | "en";
  status: AnalyticsExecutionStatus;
  startedAt: Date | null;
  maxAttempts?: number;
}

export interface AnalyticsExecutionUpdateInput {
  status: AnalyticsExecutionStatus;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  maxAttempts?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}
