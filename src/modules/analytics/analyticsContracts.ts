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
  | EvidenceCatalogMetricEntry
  | EvidenceCatalogThemeEntry;

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
  targetGroups: string[];
  areaOfOperation: string | null;
}
