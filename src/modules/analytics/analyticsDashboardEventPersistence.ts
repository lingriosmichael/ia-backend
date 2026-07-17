import type {
  AnalyticsDashboardUsageSummary,
  AnalyticsScopeType,
} from "./analyticsContracts.js";

export const analyticsDashboardInteractionTypeValues = [
  "dashboard_viewed",
  "widget_hidden",
  "widget_shown",
  "layout_reordered",
  "layout_restored",
] as const;
export type AnalyticsDashboardInteractionType =
  (typeof analyticsDashboardInteractionTypeValues)[number];

export const analyticsDashboardCompatibilitySourceValues = [
  "generated",
  "compatibility_fallback",
] as const;
export type AnalyticsDashboardCompatibilitySource =
  (typeof analyticsDashboardCompatibilitySourceValues)[number];

export interface AnalyticsDashboardEventPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  userId: string;
  resultId: string;
  interactionType: AnalyticsDashboardInteractionType;
  dashboardSchemaVersion: string;
  dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  visibleWidgetIds: string[];
  widgetId: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsDashboardEventCreateInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  userId: string;
  resultId: string;
  interactionType: AnalyticsDashboardInteractionType;
  dashboardSchemaVersion: string;
  dashboardCompatibilitySource: AnalyticsDashboardCompatibilitySource;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  visibleWidgetIds: string[];
  widgetId: string | null;
  occurredAt: Date;
}

export type AnalyticsDashboardUsageSummaryPersistenceRecord =
  AnalyticsDashboardUsageSummary;
