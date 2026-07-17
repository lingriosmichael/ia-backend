import type {
  InterpretationQualitativeFindingCategory,
  InterpretationQualitativeOutcomeAnchorType,
  InterpretationWarningSeverity,
  KnowledgeIndicatorDeduplicationConfidence,
} from "../../shared/contracts.js";

// Shared domain types for the analytics module — see
// "Phase 5 — Deterministic Analytics.md" for the full design. Kept local
// to this module (not shared/contracts.ts) since nothing outside the
// analytics module needs to reference these shapes.

export const analyticsScopeTypeValues = ["PROJECT", "ACTIVITY"] as const;
export type AnalyticsScopeType = (typeof analyticsScopeTypeValues)[number];

export interface AnalyticsScope {
  type: AnalyticsScopeType;
  projectId: string;
  activityId: string | null;
}

export const analyticsExecutionStatusValues = [
  "NOT_STARTED",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "STALE",
] as const;
export type AnalyticsExecutionStatus =
  (typeof analyticsExecutionStatusValues)[number];

export const evidenceCatalogEntryTypeValues = [
  "METRIC",
  "QUALITATIVE_THEME",
] as const;
export type EvidenceCatalogEntryType =
  (typeof evidenceCatalogEntryTypeValues)[number];

export interface EvidenceCatalogMetricProvenance {
  knowledgeEntityId: string;
  uploadMetadataId: string;
  interpretationResultId: string;
  sourceReference: string;
}

export interface EvidenceCatalogMetricEntry {
  entryId: string;
  entryType: "METRIC";
  label: string;
  description: string;
  value: number;
  unit: string | null;
  deduplicationConfidence: KnowledgeIndicatorDeduplicationConfidence;
  activityId: string;
  provenance: EvidenceCatalogMetricProvenance;
}

export interface EvidenceCatalogThemeEntry {
  entryId: string;
  entryType: "QUALITATIVE_THEME";
  label: string;
  description: string;
  quoteCount: number;
  categories: InterpretationQualitativeFindingCategory[];
  outcomeReferences: string[];
  outcomeAnchorTypes: InterpretationQualitativeOutcomeAnchorType[];
  sourceActivityIds: string[];
  sourceUploadMetadataIds: string[];
}

export type EvidenceCatalogEntry =
  EvidenceCatalogMetricEntry | EvidenceCatalogThemeEntry;

export const evidenceCatalogQualitySignalSourceValues = [
  "dataset_preparation",
  "deterministic_analysis",
  "catalog_assembly",
] as const;
export type EvidenceCatalogQualitySignalSource =
  (typeof evidenceCatalogQualitySignalSourceValues)[number];

export interface EvidenceCatalogQualitySignal {
  signalId: string;
  sourceType: EvidenceCatalogQualitySignalSource;
  interpretationResultId: string;
  activityId: string | null;
  uploadMetadataId: string;
  severity: InterpretationWarningSeverity;
  message: string;
}

export interface EvidenceCatalogOmittedEntry {
  knowledgeEntityId: string;
  reason: string;
}

export interface EvidenceCatalog {
  catalogVersion: string;
  knowledgeModelVersion: number;
  scope: AnalyticsScope;
  entries: EvidenceCatalogEntry[];
  omittedEntries: EvidenceCatalogOmittedEntry[];
  qualitySignals: EvidenceCatalogQualitySignal[];
}

export const ANALYTICS_DASHBOARD_SCHEMA_VERSION = "dashboard-v2";
export const analyticsDashboardWidgetKindValues = [
  "kpi",
  "summary",
  "horizontal_bar",
  "line_series",
  "category_rank",
  "theme_list",
] as const;
export type AnalyticsDashboardWidgetKind =
  (typeof analyticsDashboardWidgetKindValues)[number];

export interface AnalyticsDashboardGoalLinkage {
  outcomeReferences: string[];
  successIndicators: string[];
  matchedProjectGoalPhrases: string[];
}

export interface AnalyticsDashboardQualityFlag {
  sourceType: EvidenceCatalogQualitySignalSource;
  severity: InterpretationWarningSeverity;
  message: string;
}

export interface AnalyticsDashboardWidgetBase {
  widgetId: string;
  kind: AnalyticsDashboardWidgetKind;
  title: string;
  subtitle: string | null;
  description: string;
  sourceActivityIds: string[];
  sourceUploadMetadataIds: string[];
  goalLinkage: AnalyticsDashboardGoalLinkage;
  qualityFlags: AnalyticsDashboardQualityFlag[];
}

export interface AnalyticsDashboardKpiWidget extends AnalyticsDashboardWidgetBase {
  kind: "kpi";
  entryId: string;
  label: string;
  description: string;
  value: number;
  unit: string | null;
  deduplicationConfidence: KnowledgeIndicatorDeduplicationConfidence;
}

export interface AnalyticsDashboardSummaryWidget extends AnalyticsDashboardWidgetBase {
  kind: "summary";
  paragraphs: string[];
  referencedEntryIds: string[];
}

export interface AnalyticsDashboardHorizontalBarItem {
  id: string;
  label: string;
  description: string;
  value: number;
  unit: string | null;
  entryId: string | null;
}

export interface AnalyticsDashboardHorizontalBarWidget extends AnalyticsDashboardWidgetBase {
  kind: "horizontal_bar";
  unit: string | null;
  items: AnalyticsDashboardHorizontalBarItem[];
}

export interface AnalyticsDashboardLineSeriesPoint {
  label: string;
  value: number;
}

export interface AnalyticsDashboardLineSeriesWidget extends AnalyticsDashboardWidgetBase {
  kind: "line_series";
  label: string;
  tableName: string;
  activityId: string | null;
  unit: "count" | "ratio";
  points: AnalyticsDashboardLineSeriesPoint[];
}

export interface AnalyticsDashboardCategoryRankItem {
  id: string;
  label: string;
  value: number;
}

export interface AnalyticsDashboardCategoryRankWidget extends AnalyticsDashboardWidgetBase {
  kind: "category_rank";
  label: string;
  tableName: string;
  activityId: string | null;
  unit: "count" | "ratio";
  items: AnalyticsDashboardCategoryRankItem[];
}

export interface AnalyticsDashboardThemeListItem {
  entryId: string;
  label: string;
  description: string;
  quoteCount: number;
  outcomeReference: string | null;
}

export interface AnalyticsDashboardThemeListWidget extends AnalyticsDashboardWidgetBase {
  kind: "theme_list";
  items: AnalyticsDashboardThemeListItem[];
}

export type AnalyticsDashboardWidget =
  | AnalyticsDashboardKpiWidget
  | AnalyticsDashboardSummaryWidget
  | AnalyticsDashboardHorizontalBarWidget
  | AnalyticsDashboardLineSeriesWidget
  | AnalyticsDashboardCategoryRankWidget
  | AnalyticsDashboardThemeListWidget;

export interface AnalyticsDashboardWidgetCopyCandidate {
  widgetId: string;
  kind: AnalyticsDashboardWidgetKind;
  currentTitle: string;
  currentDescription: string;
  contextLines: string[];
}

export interface AnalyticsDashboardWidgetCopySuggestion {
  widgetId: string;
  title: string;
  description: string;
}

export interface AnalyticsDashboardLayoutDefinition {
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
}

export interface AnalyticsDashboard {
  schemaVersion: string;
  availableWidgets: AnalyticsDashboardWidget[];
  defaultLayout: AnalyticsDashboardLayoutDefinition;
}

export interface AnalyticsDashboardUsageSummary {
  resultId: string;
  totalEvents: number;
  dashboardViewCount: number;
  widgetHideCount: number;
  widgetShowCount: number;
  layoutReorderCount: number;
  layoutRestoreCount: number;
  lastOccurredAt: Date | null;
  lastViewedAt: Date | null;
}

export interface AnalyticsDashboardExportSection {
  widgetId: string;
  kind: AnalyticsDashboardWidget["kind"];
  title: string;
  subtitle: string | null;
  description: string;
  lines: string[];
}

export interface AnalyticsDashboardExportDocument {
  resultId: string;
  projectId: string;
  activityId: string | null;
  scopeType: AnalyticsScopeType;
  dashboardSchemaVersion: string;
  dashboardCompatibilitySource: "generated" | "compatibility_fallback";
  visibleWidgetIds: string[];
  hiddenWidgetIds: string[];
  sections: AnalyticsDashboardExportSection[];
  dataQualityWarnings: string[];
  generatedAt: Date;
}

export interface DashboardCurationNarrative {
  text: string;
  referencedEntryIds: string[];
}

export const groundingStatusValues = ["PASSED", "FAILED"] as const;
export type GroundingStatus = (typeof groundingStatusValues)[number];

// Hand-kept in sync with CURATOR_MODEL_VERSION in
// ia_python_service/app/analytics/curation.py. There is no shared package
// between the two services, so this is a deliberate manual-sync point —
// bumping the Python constant without bumping this one means staleness
// detection (Section 9 of the Phase 5 doc) silently stops firing on a
// curator logic change. Keep the two edits in the same commit.
export const CURATOR_MODEL_VERSION = "curator-prompt-v1";

export interface DashboardCuration {
  featuredEntryIds: string[];
  narrative: DashboardCurationNarrative[];
  groundingStatus: GroundingStatus;
  groundingRetryCount: number;
  curatorModelVersion: string;
  fellBackToSelectionOnly: boolean;
}

export interface AnalyticsDataQuality {
  recordsExcludedCount: number;
  warnings: string[];
}

export interface ProjectContextForCuration {
  name: string;
  projectGoal: string | null;
  impactModel: {
    inputs: string | null;
    activities: string | null;
    outputs: string | null;
    outcomes: string | null;
    impact: string | null;
  } | null;
  successIndicators: string | null;
  targetGroups: string[];
  areaOfOperation: string | null;
}
