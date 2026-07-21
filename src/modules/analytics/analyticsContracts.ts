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

// Weak/moderate/strong bucketing of a KnowledgeIndicator's numeric
// confidence — computed once, server-side (see evidenceStrength.ts), and
// attached to the catalog entry rather than left for an LLM to restate.
export const evidenceStrengthValues = ["weak", "moderate", "strong"] as const;
export type EvidenceStrength = (typeof evidenceStrengthValues)[number];

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
  evidenceStrength: EvidenceStrength;
}

export interface EvidenceCatalogThemeSourceInstance {
  uploadMetadataId: string;
  interpretationResultId: string;
  sourceReference: string;
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
  // Per-instance provenance for the individual qualitative findings merged
  // into this theme — no evidenceStrength here: KnowledgeEntity carries no
  // confidence field, so quoteCount is the corroboration signal instead of
  // a manufactured one.
  sourceInstances: EvidenceCatalogThemeSourceInstance[];
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

// --- Report Readiness Check ("Berichtscheck") -----------------------------
// Consumes the same EvidenceCatalog/ProjectContextForCuration as the
// dashboard curator above, plus open (pending) interpretation questions and
// per-activity evidence coverage — the two things the catalog doesn't carry.
// Mirrors ia_python_service's app/analytics/models.py Report Readiness types.

export interface ReportReadinessOpenQuestion {
  questionId: string;
  prompt: string;
  questionDomain: "preparation" | "interpretation";
  isBlocking: boolean;
  activityId: string;
  activityName: string;
}

export interface ReportReadinessActivityCoverage {
  activityId: string;
  activityName: string;
  isAcknowledged: boolean;
  hasFullyInterpretedEvidence: boolean;
}

export interface ReportReadinessFinding {
  statement: string;
  sourceEntryIds: string[];
  // Human-readable catalog entry labels, same order as sourceEntryIds —
  // looked up server-side so the frontend never renders a raw entryId.
  sourceLabels: string[];
  kind: "observed_fact" | "interpretation";
  caveat: string | null;
  evidenceStrength: EvidenceStrength | null;
}

export interface ReportReadinessGapFinding {
  gap: string;
  whyItMattersForReporting: string;
  relatedOmittedEntryIds: string[];
}

export const reportReadinessDeviationSignalTypeValues = [
  "contradiction",
  "low_confidence",
  "sharp_cross_activity_difference",
] as const;
export type ReportReadinessDeviationSignalType =
  (typeof reportReadinessDeviationSignalTypeValues)[number];

export interface ReportReadinessDeviationFinding {
  observation: string;
  signalType: ReportReadinessDeviationSignalType;
  sourceEntryIds: string[];
  sourceLabels: string[];
  suggestedQuestionForTeam: string;
  evidenceStrength: EvidenceStrength | null;
}

export const reportReadinessLevelValues = [
  "not_ready",
  "partially_ready",
  "ready_with_caveats",
  "ready",
] as const;
export type ReportReadinessLevel = (typeof reportReadinessLevelValues)[number];

export interface ReportReadinessOverallReadiness {
  level: ReportReadinessLevel;
  rationale: string;
}

export interface ReportReadinessEvidenceSummaryRow {
  area: string;
  whatWeKnow: string;
  sourceEntryIds: string[];
  sourceLabels: string[];
  // The weakest evidenceStrength among cited METRIC entries — same
  // derivation as ReportReadinessFinding.evidenceStrength, never asserted
  // by the LLM.
  confidence: EvidenceStrength | null;
  mainGap: string;
}

export interface ReportReadinessHonestStory {
  narrative: string;
  sourceEntryIds: string[];
  sourceLabels: string[];
}

export interface ReportReadinessActionItem {
  action: string;
  reason: string;
}

export const reportReadinessActionPriorityValues = [
  "critical_before_reporting",
  "needed_this_cycle",
] as const;
export type ReportReadinessActionPriority =
  (typeof reportReadinessActionPriorityValues)[number];

export interface ReportReadinessPriorityActionItem {
  action: string;
  reason: string;
  priority: ReportReadinessActionPriority;
}

// Hand-kept in sync with REPORT_READINESS_MODEL_VERSION in
// ia_python_service/app/analytics/models.py — same manual-sync rationale as
// CURATOR_MODEL_VERSION above. Keep both edits in the same commit.
export const REPORT_READINESS_MODEL_VERSION = "report-readiness-prompt-v2";

export interface ReportReadinessCheckResult {
  overallReadiness: ReportReadinessOverallReadiness;
  evidenceSummary: ReportReadinessEvidenceSummaryRow[];
  confidentlyReportable: ReportReadinessFinding[];
  reportableWithCaveats: ReportReadinessFinding[];
  missingOrWeakEvidence: ReportReadinessGapFinding[];
  deviationsRequiringExplanation: ReportReadinessDeviationFinding[];
  honestEmergingStory: ReportReadinessHonestStory;
  actionsBeforeReporting: ReportReadinessPriorityActionItem[];
  improvementsForNextPeriod: ReportReadinessActionItem[];
  groundingStatus: GroundingStatus;
  groundingRetryCount: number;
  reportReadinessModelVersion: string;
  fellBackToSelectionOnly: boolean;
  generatedAt: Date;
}
