export const organizationRoleValues = [
  "ORGANIZATION_ADMIN",
  "PROJECT_MANAGER",
] as const;
export type OrganizationRole = (typeof organizationRoleValues)[number];

export const projectStatusValues = ["planning", "active", "completed"] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

export const activityStatusValues = ["active", "completed"] as const;
export type ActivityStatus = (typeof activityStatusValues)[number];

export const uploadMetadataStatusValues = [
  "pending",
  "uploaded",
  "archived",
] as const;
export type UploadMetadataStatus = (typeof uploadMetadataStatusValues)[number];

export const processingJobStatusValues = [
  "queued",
  "processing",
  "awaiting_privacy_review",
  "transforming",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ProcessingJobStatus = (typeof processingJobStatusValues)[number];
export const aiExecutionStatusValues = processingJobStatusValues;
export type AIExecutionStatus = ProcessingJobStatus;

export const activeProcessingJobStatusValues = [
  "queued",
  "processing",
  "awaiting_privacy_review",
  "transforming",
] as const;
export type ActiveProcessingJobStatus =
  (typeof activeProcessingJobStatusValues)[number];

export const processingJobTypeValues = [
  "evidence_processing",
  "dataset_interpretation",
  "dataset_review",
  "metrics_generation",
  "dashboard_generation",
  "insight_generation",
  "report_generation",
  "chat",
  "other",
] as const;
export type ProcessingJobType = (typeof processingJobTypeValues)[number];
export const aiExecutionTypeValues = processingJobTypeValues;
export type AIExecutionType = ProcessingJobType;

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationPermissions {
  canManageMembers: boolean;
  canManageBilling: boolean;
  canManageSettings: boolean;
  canCreateProject: boolean;
}

export interface OrganizationSettings {
  organizationName: string;
  legalForm: string | null;
  foundingYear: number | null;
  country: string | null;
  employeeCount: number | null;
  mission: string | null;
  activityAreas: string[];
  targetGroups: string[];
  operatingRegions: string[];
  isRecognizedNonProfit: boolean | null;
  taxExemptionValidFrom: string | null;
}

export interface ProjectPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canCreateActivity: boolean;
  canUploadEvidence: boolean;
}

export interface ActivityPermissions {
  canEdit: boolean;
  canUploadEvidence: boolean;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  mission: string | null;
  logoUrl: string | null;
  memberCount: number | null;
  settings: OrganizationSettings;
  role: OrganizationRole;
  permissions: OrganizationPermissions;
  createdAt: string;
}

export interface ProjectImpactModel {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  impact: string | null;
  outcomes: string | null;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  startMonth: string | null;
  endMonth: string | null;
  fundingProgram: string | null;
  fundingOrganization: string | null;
  targetGroups: string[];
  areaOfOperation: string | null;
  partnerships: string | null;
  sdgs: string[];
  impactModel: ProjectImpactModel;
  successIndicators: string | null;
  status: ProjectStatus;
  permissions: ProjectPermissions;
  createdAt: string;
  updatedAt: string;
}

export interface ActivitySummary {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  activityType: string | null;
  owner: string | null;
  startDate: string | null;
  endDate: string | null;
  objectives: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  additionalContext: string | null;
  status: ActivityStatus;
  permissions: ActivityPermissions;
  interpretationAcknowledgedAt: string | null;
  interpretationAcknowledgedById: string | null;
  interpretationAcknowledgedByName: string | null;
  aiKnowledgeGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberSummary {
  id: string;
  userId: string;
  organizationId: string;
  fullName: string;
  email: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: Extract<OrganizationRole, "PROJECT_MANAGER">;
  acceptanceMode: "create_account" | "sign_in";
  status: "pending" | "accepted" | "revoked";
  token: string;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationAcceptanceSummary {
  invitation: InvitationSummary;
  acceptanceMode: InvitationSummary["acceptanceMode"];
}

export interface SubscriptionRecord {
  id: string;
  organizationId: string;
  planName: string;
  includedAdminSeats: number;
  includedProjectManagerSeats: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadMetadataRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  logicalEvidenceId: string;
  versionNumber: number;
  replacesUploadMetadataId: string | null;
  supersededAt: string | null;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  originalFileDeletedAt: string | null;
  status: UploadMetadataStatus;
  uploadedById: string;
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingJobRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  jobType: ProcessingJobType;
  status: ProcessingJobStatus;
  triggeredById: string;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export type AIExecutionRecord = ProcessingJobRecord;

export interface ActivityUploadResponse {
  upload: UploadMetadataRecord;
}

export interface DeleteEvidenceResponse {
  id: string;
  activityId: string | null;
  projectId: string;
}

export interface ParsedRepresentationRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  fileType: "spreadsheet" | "document" | "unknown";
  interpretationDataType: InterpretationDataType;
  evidenceModality: EvidenceModality;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const interpretationDataTypeValues = [
  "tabular_structured",
  "text_narrative",
  "mixed_structured_text",
  "insufficiently_extracted",
] as const;
export type InterpretationDataType =
  (typeof interpretationDataTypeValues)[number];

export const evidenceModalityValues = [
  "structured_quantitative",
  "structured_qualitative",
  "mixed_dual_track",
  "narrative_qualitative",
  "insufficiently_extracted",
] as const;
export type EvidenceModality = (typeof evidenceModalityValues)[number];

export const evidenceRoutingDecisionSourceValues = [
  "deterministic",
  "llm_tiebreaker",
] as const;
export type EvidenceRoutingDecisionSource =
  (typeof evidenceRoutingDecisionSourceValues)[number];

export interface EvidenceRoutingDecision {
  evidenceModality: EvidenceModality;
  decisionSource: EvidenceRoutingDecisionSource;
  routingConfidence: number;
  quantitativeUtilityScore: number;
  qualitativeUtilityScore: number;
  reasons: string[];
}

export const privacyReviewDecisionValueValues = [
  "keep",
  "tokenize",
  "generalize",
  "remove",
  "restrict",
] as const;
export type PrivacyReviewDecisionValue =
  (typeof privacyReviewDecisionValueValues)[number];

export interface ParsedRepresentationPreviewTable {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
}

export interface ParsedRepresentationPreviewParagraph {
  index: number;
  page: number | null;
  sourceIndex: number | null;
  characterCount: number;
}

export interface ParsedRepresentationPreviewRecord {
  fileType: "spreadsheet" | "document" | "unknown";
  interpretationDataType: InterpretationDataType;
  evidenceModality: EvidenceModality;
  sourceFileName: string | null;
  extension: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  tableCount: number;
  paragraphCount: number;
  tables: ParsedRepresentationPreviewTable[];
  paragraphs: ParsedRepresentationPreviewParagraph[];
}

// What the client sends when resolving a review: which finding, which
// transformation action. Never includes who/when — that's stamped
// server-side (see PrivacyReviewFieldDecisionRecord) so it can't be spoofed
// by the caller.
//
export interface PrivacyReviewFieldDecisionInput {
  field: string;
  entityType: string;
  decision: PrivacyReviewDecisionValue;
  reason?: string;
  keepUnchangedAcknowledged?: boolean;
}

// What actually gets persisted and returned — the input plus a real audit
// trail of who made this specific finding's call and when.
export interface PrivacyReviewFieldDecisionRecord extends PrivacyReviewFieldDecisionInput {
  decidedById: string;
  decidedAt: string;
}

export interface PrivacyReviewDecisions {
  fieldDecisions?: PrivacyReviewFieldDecisionRecord[];
}

export interface PrivacyReviewDecisionsInput {
  fieldDecisions?: PrivacyReviewFieldDecisionInput[];
}

export interface PrivacyReviewRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  status: "pending" | "approved" | "rejected";
  findings: Record<string, unknown>;
  parsedRepresentationPreview: ParsedRepresentationPreviewRecord | null;
  decisions: PrivacyReviewDecisions | null;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacySafeRepresentationRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  privacyReviewId: string;
  parsedRepresentationId: string;
  interpretationDataType: InterpretationDataType;
  evidenceModality: EvidenceModality;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const interpretationQuestionKindValues = [
  "single_choice",
  "free_text",
  "merge_confirmation",
] as const;
export type InterpretationQuestionKind =
  (typeof interpretationQuestionKindValues)[number];

export const interpretationQuestionDomainValues = [
  "preparation",
  "interpretation",
] as const;
export type InterpretationQuestionDomain =
  (typeof interpretationQuestionDomainValues)[number];

export const interpretationQuestionCodeValues = [
  "normalization_merge",
  "row_grain",
  "duplicate_identifier_resolution",
  "primary_status_field",
  "positive_status_values",
  "primary_date_field",
] as const;
export type InterpretationQuestionCode =
  (typeof interpretationQuestionCodeValues)[number];

export const interpretationQuestionStatusValues = [
  "pending",
  "answered",
] as const;
export type InterpretationQuestionStatus =
  (typeof interpretationQuestionStatusValues)[number];

export const interpretationWarningSeverityValues = ["info", "warning"] as const;
export type InterpretationWarningSeverity =
  (typeof interpretationWarningSeverityValues)[number];

export const datasetProfileColumnTypeValues = [
  "identifier",
  "numeric",
  "date",
  "categorical",
  "free_text",
  "boolean",
  "unknown",
] as const;
export type DatasetProfileColumnType =
  (typeof datasetProfileColumnTypeValues)[number];

export interface InterpretationEntity {
  id: string;
  originalField: string;
  aiMeaning: string;
  entityType: string;
  confidence: number;
  reason: string;
  sampleValues: string[];
}

export const indicatorRelevanceStageValues = [
  "output",
  "outcome",
  "impact",
] as const;
export type IndicatorRelevanceStage =
  (typeof indicatorRelevanceStageValues)[number];

export const interpretationIndicatorStatusValues = [
  "kept",
  "rejected",
] as const;
export type InterpretationIndicatorStatus =
  (typeof interpretationIndicatorStatusValues)[number];

// Mirrors ia_python_service's IndicatorSuggestedCalculation /
// IndicatorComputedValue (app/schemas/processing.py) — see
// "Phase 4 — Project Knowledge Model.md", "Indicator Value Computation".
// A small, fixed vocabulary of general operations the model points at
// real columns to derive an indicator's value; never asks the model to
// do the arithmetic itself.
export const indicatorCalculationOperationValues = [
  "count",
  "count_distinct",
  "sum",
  "mean",
  "ratio",
  "distribution",
  "trend",
] as const;
export type IndicatorCalculationOperation =
  (typeof indicatorCalculationOperationValues)[number];

export interface InterpretationIndicatorValueFilter {
  column: string;
  acceptedValues: string[];
}

export interface InterpretationIndicatorSuggestedCalculation {
  operation: IndicatorCalculationOperation;
  column: string | null;
  groupByColumn: string | null;
  numerator: InterpretationIndicatorValueFilter | null;
  denominator: InterpretationIndicatorValueFilter | null;
  dateColumn: string | null;
  // Restricts count/count_distinct to rows matching this filter (e.g.
  // recommendation equals "geeignet") instead of merely being non-null —
  // the same shape numerator/denominator already use for ratio.
  valueFilter: InterpretationIndicatorValueFilter | null;
}

export const indicatorComputedValueSourceKindValues = [
  "computed_from_table",
  "extracted_from_text",
] as const;
export type IndicatorComputedValueSourceKind =
  (typeof indicatorComputedValueSourceKindValues)[number];

export const indicatorComputedValueGroundingStatusValues = [
  "passed",
  "failed_column_not_found",
  "failed_number_not_in_text",
] as const;
export type IndicatorComputedValueGroundingStatus =
  (typeof indicatorComputedValueGroundingStatusValues)[number];

export interface InterpretationIndicatorComputedValue {
  sourceKind: IndicatorComputedValueSourceKind;
  value: number | null;
  unit: string | null;
  components: Record<string, unknown>;
  recordsIncluded: number;
  recordsExcluded: number;
  groundingStatus: IndicatorComputedValueGroundingStatus;
}

export const interpretationQualitativeStageValues = [
  "output",
  "outcome",
  "impact",
  "context",
  "risk",
] as const;
export type InterpretationQualitativeStage =
  (typeof interpretationQualitativeStageValues)[number];

export const interpretationQuoteExcerptKindValues = [
  "direct",
  "paraphrased",
] as const;
export type InterpretationQuoteExcerptKind =
  (typeof interpretationQuoteExcerptKindValues)[number];

export const interpretationQuoteSpeakerTypeValues = [
  "participant",
  "caregiver",
  "staff",
  "volunteer",
  "evaluator",
  "unknown",
] as const;
export type InterpretationQuoteSpeakerType =
  (typeof interpretationQuoteSpeakerTypeValues)[number];

export const interpretationQuotePrivacyModeValues = [
  "verbatim_safe",
  "redacted",
  "paraphrased_only",
] as const;
export type InterpretationQuotePrivacyMode =
  (typeof interpretationQuotePrivacyModeValues)[number];

export const interpretationQualitativeFindingRelationValues = [
  "reinforces",
  "contradicts",
  "complicates",
  "context_only",
] as const;
export type InterpretationQualitativeFindingRelation =
  (typeof interpretationQualitativeFindingRelationValues)[number];

export const interpretationQualitativeFindingCategoryValues = [
  "outcome_support",
  "outcome_complication",
  "outcome_contradiction",
  "barrier",
  "enabler",
  "unintended_effect",
  "context_only",
] as const;
export type InterpretationQualitativeFindingCategory =
  (typeof interpretationQualitativeFindingCategoryValues)[number];

export const interpretationQualitativeOutcomeAnchorTypeValues = [
  "project_outcome",
  "project_impact",
  "activity_objective",
  "activity_success_indicator",
  "unanchored",
] as const;
export type InterpretationQualitativeOutcomeAnchorType =
  (typeof interpretationQualitativeOutcomeAnchorTypeValues)[number];

export interface InterpretationIndicator {
  id: string;
  name: string;
  description: string;
  confidence: number;
  reason: string;
  relatedEntityIds: string[];
  supportingParagraphKeys: string[];
  relevanceStage: IndicatorRelevanceStage | null;
  // True only when this indicator directly measures progress toward an
  // already-stated project/activity goal or success indicator — set by
  // ia_python_service's extraction call, never inferred here. Drives
  // reviewer-facing "highly recommended" labeling and is never displaced
  // by ia_python_service's emergent-indicator cap (see
  // _prioritize_and_cap_indicators in interpretation_pipeline.py).
  matchesStatedGoal: boolean;
  status: InterpretationIndicatorStatus;
  suggestedCalculation: InterpretationIndicatorSuggestedCalculation | null;
  computedValue: InterpretationIndicatorComputedValue | null;
}

export interface InterpretationRelationship {
  id: string;
  description: string;
  involvedEntityIds: string[];
  confidence: number;
}

export interface InterpretationSupportingQuote {
  id: string;
  excerptText: string;
  excerptKind: InterpretationQuoteExcerptKind;
  speakerType: InterpretationQuoteSpeakerType;
  stage: InterpretationQualitativeStage;
  confidence: number;
  reason: string;
  sourceReference: string;
  privacyMode: InterpretationQuotePrivacyMode;
}

export interface InterpretationQualitativeFinding {
  id: string;
  summary: string;
  stage: InterpretationQualitativeStage;
  confidence: number;
  reason: string;
  relatedEntityIds: string[];
  relatedIndicatorIds: string[];
  supportingQuoteIds: string[];
  category: InterpretationQualitativeFindingCategory;
  outcomeReference: string | null;
  outcomeAnchorType: InterpretationQualitativeOutcomeAnchorType;
  relationToEvidence: InterpretationQualitativeFindingRelation;
  status: InterpretationIndicatorStatus;
}

export interface InterpretationQuestion {
  id: string;
  prompt: string;
  kind: InterpretationQuestionKind;
  questionDomain: InterpretationQuestionDomain;
  options: string[] | null;
  isBlocking: boolean;
  questionCode: InterpretationQuestionCode | null;
  targetTableName: string | null;
  targetColumnName: string | null;
  status: InterpretationQuestionStatus;
  answeredValue: string | null;
  answeredById: string | null;
  answeredAt: string | null;
}

export interface InterpretationWarning {
  id: string;
  message: string;
  severity: InterpretationWarningSeverity;
}

export interface DatasetProfileValueCount {
  value: string;
  count: number;
}

export interface DatasetProfileNumericSummary {
  min: number;
  max: number;
  mean: number;
}

export interface DatasetProfileDateSummary {
  min: string;
  max: string;
}

export interface DatasetProfileColumn {
  name: string;
  inferredType: DatasetProfileColumnType;
  roleHints: string[];
  nullPercentage: number;
  distinctCount: number;
  averageTextLength: number | null;
  topValues: DatasetProfileValueCount[];
  numericSummary: DatasetProfileNumericSummary | null;
  dateSummary: DatasetProfileDateSummary | null;
  duplicateNonNullValueCount: number;
}

export const datasetProfileIssueCodeValues = [
  "duplicate_identifier",
  "missing_identifier",
  "row_grain_ambiguous",
  "multiple_date_columns",
  "multiple_status_columns",
  "status_values_need_definition",
] as const;
export type DatasetProfileIssueCode =
  (typeof datasetProfileIssueCodeValues)[number];

export interface DatasetProfileIssue {
  code: DatasetProfileIssueCode;
  severity: InterpretationWarningSeverity;
  tableName: string;
  columnName: string | null;
  message: string;
}

export interface DatasetProfileTable {
  name: string;
  rowCount: number;
  columnCount: number;
  likelyIdentifierColumns: string[];
  likelyStatusColumns: string[];
  likelyStageColumns: string[];
  likelyDateColumns: string[];
  likelyMeasureColumns: string[];
  likelyFreeTextColumns: string[];
  likelySubgroupColumns: string[];
  columns: DatasetProfileColumn[];
}

export interface DatasetProfile {
  tableCount: number;
  paragraphCount: number;
  tables: DatasetProfileTable[];
  issues: DatasetProfileIssue[];
}

export interface InterpretationGoalCoverage {
  id: string;
  goalSummary: string;
  isSupportedByData: boolean;
  relatedIndicatorIds: string[];
  gapExplanation: string | null;
}

export const datasetPreparationStatusValues = [
  "not_applicable",
  "not_started",
  "awaiting_answers",
  "ready_for_analysis",
  "analysis_completed",
] as const;
export type DatasetPreparationStatus =
  (typeof datasetPreparationStatusValues)[number];

export interface DatasetPreparationDecision {
  questionId: string;
  questionCode: InterpretationQuestionCode;
  questionPrompt: string;
  tableName: string | null;
  columnName: string | null;
  answeredValue: string;
  answeredById: string | null;
  answeredAt: string | null;
}

export interface DatasetPreparationDecisionSelection {
  questionId: string;
  tableName: string | null;
  columnName: string | null;
  value: string;
}

export interface DatasetPreparationDecisionSummary {
  normalizationMerges: DatasetPreparationDecisionSelection[];
  rowGrains: DatasetPreparationDecisionSelection[];
  duplicateIdentifierResolutions: DatasetPreparationDecisionSelection[];
  primaryStatusFields: DatasetPreparationDecisionSelection[];
  positiveStatusDefinitions: DatasetPreparationDecisionSelection[];
  primaryDateFields: DatasetPreparationDecisionSelection[];
}

export const preparedDatasetColumnRoleValues = [
  "identifier",
  "primary_status",
  "primary_date",
  "measure",
  "subgroup",
  "free_text",
  "other",
] as const;
export type PreparedDatasetColumnRole =
  (typeof preparedDatasetColumnRoleValues)[number];

export const preparedDatasetIdentifierHandlingValues = [
  "assume_unique",
  "allow_duplicate_rows_as_events",
  "deduplicate_by_identifier",
  "manual_review_required",
] as const;
export type PreparedDatasetIdentifierHandling =
  (typeof preparedDatasetIdentifierHandlingValues)[number];

export interface PreparedDatasetColumn {
  name: string;
  inferredType: DatasetProfileColumnType | null;
  role: PreparedDatasetColumnRole;
  positiveStatusValues: string[];
  positiveStatusDefinitionText: string | null;
  normalizationAccepted: boolean | null;
}

export interface PreparedDatasetTable {
  name: string;
  rowCount: number;
  columnCount: number;
  selectedRowGrain: string | null;
  identifierColumn: string | null;
  identifierHandling: PreparedDatasetIdentifierHandling | null;
  primaryStatusColumn: string | null;
  primaryDateColumn: string | null;
  columns: PreparedDatasetColumn[];
  notes: string[];
}

export interface PreparedDatasetSnapshot {
  evidenceModality: EvidenceModality;
  isReadyForDeterministicAnalysis: boolean;
  unresolvedRequirements: string[];
  tables: PreparedDatasetTable[];
}

export const deterministicAnalysisStatusValues = [
  "not_applicable",
  "awaiting_preparation",
  "ready",
] as const;
export type DeterministicAnalysisStatus =
  (typeof deterministicAnalysisStatusValues)[number];

export const deterministicAnalysisMetricKindValues = [
  "count",
  "count_distinct",
  "ratio",
  "distribution",
  "trend",
] as const;
export type DeterministicAnalysisMetricKind =
  (typeof deterministicAnalysisMetricKindValues)[number];

export interface DeterministicAnalysisMetric {
  metricKey: string;
  label: string;
  description: string;
  tableName: string;
  sourceColumns: string[];
  kind: DeterministicAnalysisMetricKind;
  formula: string;
  value: number | null;
  unit: string | null;
  components: Record<string, unknown>;
}

export interface DeterministicAnalysisDistributionBucket {
  value: string | null;
  count: number;
  ratio: number | null;
}

export interface DeterministicAnalysisDistribution {
  distributionKey: string;
  label: string;
  tableName: string;
  columnName: string;
  buckets: DeterministicAnalysisDistributionBucket[];
}

export interface DeterministicAnalysisTrendPoint {
  period: string;
  rowCount: number;
  positiveCount: number | null;
  positiveRatio: number | null;
}

export interface DeterministicAnalysisTrend {
  trendKey: string;
  label: string;
  tableName: string;
  dateColumnName: string;
  positiveStatusColumnName: string | null;
  points: DeterministicAnalysisTrendPoint[];
}

export interface DeterministicAnalysisSubgroupSegment {
  value: string | null;
  rowCount: number;
  positiveCount: number | null;
  positiveRatio: number | null;
}

export interface DeterministicAnalysisSubgroupBreakdown {
  breakdownKey: string;
  label: string;
  tableName: string;
  columnName: string;
  segments: DeterministicAnalysisSubgroupSegment[];
}

export interface DeterministicAnalysisWarning {
  code: string;
  message: string;
}

export interface DeterministicAnalysisCategoricalCrosstabCell {
  valueA: string | null;
  valueB: string | null;
  count: number;
  ratio: number | null;
}

export interface DeterministicAnalysisCategoricalCrosstab {
  crosstabKey: string;
  label: string;
  tableName: string;
  columnAName: string;
  columnBName: string;
  cells: DeterministicAnalysisCategoricalCrosstabCell[];
}

export interface DeterministicAnalysisNumericCategoryGroup {
  categoryValue: string | null;
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  q1: number | null;
  q3: number | null;
}

export interface DeterministicAnalysisNumericCategorySummary {
  summaryKey: string;
  label: string;
  tableName: string;
  numericColumnName: string;
  categoryColumnName: string;
  groups: DeterministicAnalysisNumericCategoryGroup[];
}

export interface DeterministicAnalysisNumericCorrelation {
  correlationKey: string;
  label: string;
  tableName: string;
  columnAName: string;
  columnBName: string;
  completePairCount: number;
  pearson: number | null;
  spearman: number | null;
}

export interface DeterministicAnalysisCandidateIndicator {
  indicatorKey: string;
  label: string;
  description: string;
  tableName: string;
  formula: string;
  value: number | null;
  unit: string | null;
  sourceColumns: string[];
  groundingNote: string;
}

export interface DeterministicAnalysisRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  datasetPreparationId: string;
  status: DeterministicAnalysisStatus;
  metrics: DeterministicAnalysisMetric[];
  distributions: DeterministicAnalysisDistribution[];
  trends: DeterministicAnalysisTrend[];
  subgroupBreakdowns: DeterministicAnalysisSubgroupBreakdown[];
  categoricalCrosstabs: DeterministicAnalysisCategoricalCrosstab[];
  numericCategorySummaries: DeterministicAnalysisNumericCategorySummary[];
  numericCorrelations: DeterministicAnalysisNumericCorrelation[];
  warnings: DeterministicAnalysisWarning[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetPreparationRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  status: DatasetPreparationStatus;
  blockingQuestionCount: number;
  answeredBlockingQuestionCount: number;
  unansweredBlockingQuestionIds: string[];
  decisions: DatasetPreparationDecision[];
  decisionSummary: DatasetPreparationDecisionSummary;
  preparedDataset: PreparedDatasetSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterpretationResultRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  processingJobId: string;
  versionNumber: number;
  previousInterpretationResultId: string | null;
  datasetType: string;
  overallConfidence: number;
  evidenceRouting: EvidenceRoutingDecision | null;
  datasetProfile: DatasetProfile | null;
  entities: InterpretationEntity[];
  indicators: InterpretationIndicator[];
  relationships: InterpretationRelationship[];
  qualitativeFindings: InterpretationQualitativeFinding[];
  supportingQuotes: InterpretationSupportingQuote[];
  questions: InterpretationQuestion[];
  warnings: InterpretationWarning[];
  goalAlignment: InterpretationGoalCoverage[];
  llmUsage: LlmUsageSummary | null;
  datasetPreparation: DatasetPreparationRecord | null;
  deterministicAnalysis: DeterministicAnalysisRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInterpretationOverview {
  results: InterpretationResultRecord[];
}

export interface StartInterpretationResponse {
  job: ProcessingJobRecord;
}

export interface StartActivityInterpretationResponse {
  jobs: ProcessingJobRecord[];
  startedCount: number;
  skippedCount: number;
}

export type ActivityAiKnowledgeInsightSourceType =
  | "goal_alignment"
  | "qualitative_finding"
  | "indicator"
  | "distribution_signal";

export interface ActivityAiKnowledgeInsight {
  id: string;
  sourceType: ActivityAiKnowledgeInsightSourceType;
  text: string;
  isGoalRelevant: boolean;
  sourceUploadMetadataIds: string[];
}

export interface LlmUsageCall {
  stageName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
}

export interface LlmUsageSummary {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  calls: LlmUsageCall[];
}

export interface ActivityAiKnowledgeRecord {
  activityId: string;
  projectId: string;
  activityName: string;
  interpretedEvidenceCount: number;
  totalEvidenceCount: number;
  generatedAt: string | null;
  summaryText: string;
  insights: ActivityAiKnowledgeInsight[];
}

export interface AnswerInterpretationQuestionRequest {
  answeredValue: string;
}

export interface DeleteActivityResponse {
  id: string;
  projectId: string;
}

export interface WorkspaceActivity extends ActivitySummary {
  uploadMetadataCount: number;
  processingJobCount: number;
}

export interface WorkspaceProject extends ProjectSummary {
  activities: WorkspaceActivity[];
}

export interface OrganizationWorkspace {
  organization: OrganizationSummary;
  projects: WorkspaceProject[];
}

export type ProjectRecentActivityType =
  | "activity_created"
  | "dataset_uploaded"
  | "job_completed"
  | "job_failed"
  | "insight_generated";

export interface ProjectRecentActivityItem {
  id: string;
  type: ProjectRecentActivityType;
  occurredAt: string;
  activityId: string | null;
  activityName: string | null;
}

export interface ProjectOverviewMetrics {
  activityCount: number;
  uploadedDatasetCount: number;
  activitiesWithDatasetsCount: number;
  insightCount: number;
  pendingInsightCount: number;
  failedJobCount: number;
  lastUploadAt: string | null;
}

export interface ProjectOverview {
  project: ProjectSummary;
  activities: WorkspaceActivity[];
  metrics: ProjectOverviewMetrics;
  recentActivity: ProjectRecentActivityItem[];
}

export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: UserSummary;
  organizations: OrganizationSummary[];
}

export interface SessionResponse {
  user: UserSummary;
  organizations: OrganizationSummary[];
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: Extract<OrganizationRole, "PROJECT_MANAGER">;
}

export interface AcceptInvitationRequest {
  fullName: string;
  password: string;
}

export interface CreateOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  mission?: string | null;
}

export interface CreateProjectRequest {
  name: string;
  startMonth: string;
  endMonth: string;
  fundingProgram: string;
  fundingOrganization: string;
  targetGroups: string[];
  areaOfOperation: string;
  partnerships?: string;
  sdgs?: string[];
  impactModel: {
    inputs: string;
    activities: string;
    outputs: string;
    impact: string;
    outcomes: string;
  };
  successIndicators: string;
}

export interface UpdateProjectRequest {
  name?: string;
  startMonth?: string | null;
  endMonth?: string | null;
  fundingProgram?: string | null;
  fundingOrganization?: string | null;
  targetGroups?: string[];
  areaOfOperation?: string | null;
  partnerships?: string | null;
  sdgs?: string[];
  impactModel?: {
    inputs?: string | null;
    activities?: string | null;
    outputs?: string | null;
    impact?: string | null;
    outcomes?: string | null;
  };
  successIndicators?: string | null;
}

export interface CreateActivityRequest {
  name: string;
  description?: string;
  activityType?: string;
  owner?: string;
  startDate?: string;
  endDate?: string;
  objectives?: string;
  successIndicators?: string;
  targetAudience?: string;
  additionalContext?: string;
  status?: ActivityStatus;
}

export interface UpdateActivityRequest {
  name?: string;
  description?: string | null;
  activityType?: string | null;
  owner?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  objectives?: string | null;
  successIndicators?: string | null;
  targetAudience?: string | null;
  additionalContext?: string | null;
  status?: ActivityStatus;
}

export interface CreateUploadMetadataRequest {
  originalFileName: string;
  contentType?: string;
  sizeBytes?: number;
  storageKey?: string;
  activityId?: string | null;
  replacesUploadMetadataId?: string | null;
}

export interface UpdateUploadMetadataRequest {
  contentType?: string | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
  supersededAt?: string | null;
  originalFileDeletedAt?: string | null;
  status?: UploadMetadataStatus;
}

export interface CreateProcessingJobRequest {
  activityId?: string | null;
  uploadMetadataId?: string | null;
  jobType: ProcessingJobType;
  payload?: Record<string, unknown>;
}
export type CreateAIExecutionRequest = CreateProcessingJobRequest;

export interface UpdateProcessingJobRequest {
  status?: ProcessingJobStatus;
  payload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}
export type UpdateAIExecutionRequest = UpdateProcessingJobRequest;

export interface StartEvidenceAnalysisResponse {
  job: ProcessingJobRecord;
}

export interface ApprovePrivacyReviewRequest {
  decisions?: Record<string, unknown>;
}

export interface ApprovePrivacyReviewResponse {
  review: PrivacyReviewRecord;
  job: ProcessingJobRecord;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

// ============================================================
// Project Knowledge Model (Phase 4, Part B)
// ============================================================

export const projectKnowledgeModelStatusValues = [
  "building",
  "ready",
  "stale",
] as const;
export type ProjectKnowledgeModelStatus =
  (typeof projectKnowledgeModelStatusValues)[number];

export const knowledgeEntityTypeValues = [
  "participant",
  "mentor",
  "activity",
  "outcome",
  "location",
  "indicator",
  "session",
  "theme",
  "organization",
  "evidence_source",
] as const;
export type KnowledgeEntityType = (typeof knowledgeEntityTypeValues)[number];

// Carried on a KnowledgeSourceInstance when the indicator it came from had
// a computedValue (see "Phase 4 — Project Knowledge Model.md", "Indicator
// Value Computation") — this is what lets ProjectKnowledgeBuilderService
// recombine values across merged source instances using `components`
// (e.g. sum-then-divide a ratio's numerator/denominator) instead of
// re-deriving from raw rows or naively averaging already-divided values.
export interface KnowledgeSourceInstanceComputedValue {
  sourceKind: IndicatorComputedValueSourceKind;
  operation: IndicatorCalculationOperation | null;
  value: number | null;
  unit: string | null;
  components: Record<string, unknown>;
  groundingStatus: IndicatorComputedValueGroundingStatus;
  confidence: number;
}

export interface KnowledgeSourceInstanceQualitativeContext {
  category: InterpretationQualitativeFindingCategory;
  outcomeReference: string | null;
  outcomeAnchorType: InterpretationQualitativeOutcomeAnchorType;
  relationToEvidence: InterpretationQualitativeFindingRelation;
}

export interface KnowledgeSourceInstance {
  uploadMetadataId: string;
  interpretationResultId: string;
  activityId: string;
  activityType: string | null;
  sourceReference: string;
  addedAt: string;
  computedValue?: KnowledgeSourceInstanceComputedValue | null;
  qualitativeContext?: KnowledgeSourceInstanceQualitativeContext | null;
}

// Set on a KnowledgeIndicator only for count_distinct operations recombined
// across more than one source instance — cross-file participant identity
// is deliberately unresolved (see "Stable Cross-File Identity" in
// "Phase 4 — Project Knowledge Model.md"), so a summed distinct-count
// across files can double-count a participant appearing in both. This
// must be labeled honestly rather than presented as deduplicated.
export const knowledgeIndicatorDeduplicationConfidenceValues = [
  "deduplicated",
  "not_deduplicated_across_sources",
  "not_applicable",
] as const;
export type KnowledgeIndicatorDeduplicationConfidence =
  (typeof knowledgeIndicatorDeduplicationConfidenceValues)[number];
