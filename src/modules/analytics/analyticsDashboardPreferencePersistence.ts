import type { AnalyticsScopeType } from "./analyticsContracts.js";

export interface AnalyticsDashboardPreferencePersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  dashboardSchemaVersion: string;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsDashboardPreferenceUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  dashboardSchemaVersion: string;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  updatedById: string;
}
