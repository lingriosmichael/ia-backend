export const organizationRoleValues = [
  "ORGANIZATION_ADMIN",
  "PROJECT_MANAGER",
] as const;
export type OrganizationRole = (typeof organizationRoleValues)[number];

export const projectStatusValues = ["planning", "active", "completed"] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

export const activityStatusValues = ["active", "completed"] as const;
export type ActivityStatus = (typeof activityStatusValues)[number];

export const activitySystemTypeValues = [
  "baseline",
  "impact_measurement",
] as const;
export type ActivitySystemType = (typeof activitySystemTypeValues)[number];

// cross-evidence-linkage-design.md §11. Computed fresh on every request
// from uploads/jobs/results/linkage state (see
// ia_backend/src/modules/activity/activityWorkflowStage.ts) — not stored,
// so it can never drift from the data it's derived from. Distinct from
// `ActivityStatus` above, which only tracks active/completed.
export const activityWorkflowStageValues = [
  "no_evidence",
  "privacy_review",
  "analysis_pending",
  "analysis_running",
  "needs_clarification",
  "qualitative_review",
  "goal_review",
  "assessment_ready",
  "reviewed",
] as const;
export type ActivityWorkflowStage =
  (typeof activityWorkflowStageValues)[number];

export interface ActivityWorkflowStageRecord {
  activityId: string;
  stage: ActivityWorkflowStage;
}

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

export const activeProcessingJobStatusValues = [
  "queued",
  "processing",
  "awaiting_privacy_review",
  "transforming",
] as const;
export type ActiveProcessingJobStatus =
  (typeof activeProcessingJobStatusValues)[number];

export const processingJobTypeValues = [
  "workbook_split",
  "evidence_processing",
  "dataset_interpretation",
  "dataset_review",
  "metrics_generation",
  "dashboard_generation",
  "insight_generation",
  "report_generation",
  "chat",
  "other",
  "activity_analysis_v2",
  "qualitative_coding_review",
  "project_impact_story",
] as const;
export type ProcessingJobType = (typeof processingJobTypeValues)[number];

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
  canManageLifecycle: boolean;
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
  initialSituation: string | null;
  startMonth: string | null;
  endMonth: string | null;
  fundingProgram: string | null;
  fundingOrganization: string | null;
  targetGroups: string[];
  overarchingTargetGroup: string | null;
  intendedChanges: string[];
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
  systemType: ActivitySystemType | null;
  name: string;
  description: string | null;
  activityType: string | null;
  startDate: string | null;
  endDate: string | null;
  targetAudience: string | null;
  objectives: string | null;
  output: string | null;
  // Free text, in the activity author's own words, describing what a
  // narrow safeguarding/concern-tagging pass over this activity's
  // free-text evidence columns should watch for (e.g. "flag any note
  // suggesting a boundary or safety concern"). Null/empty means the
  // activity hasn't opted into this — evidence linkage never runs the
  // tagging pass or calls the LLM for it in that case. Kept as an
  // activity-scoped, human-authored instruction (mirrors how
  // positiveStatusValues is human-confirmed rather than guessed) instead
  // of a hardcoded "safeguarding" concept, so the platform stays generic
  // across activity types.
  concernTaggingInstruction: string | null;
  status: ActivityStatus;
  permissions: ActivityPermissions;
  interpretationAcknowledgedAt: string | null;
  interpretationAcknowledgedById: string | null;
  interpretationAcknowledgedByName: string | null;
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
  sourceWorkbookUploadMetadataId: string | null;
  derivedSheetName: string | null;
  derivedSheetIndex: number | null;
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

export interface QualitativeCodingReviewSuggestedCode {
  code: string;
  label: string;
  description: string;
  exampleExcerpts: string[];
}

export interface QualitativeCodingReviewProposedAssignment {
  rowIndex: number;
  assignedCode: string | null;
}

export interface QualitativeCodingReviewFindingRecord {
  findingKey: string;
  tableName: string;
  textColumnName: string;
  syntheticCodeColumnName: string;
  rowCount: number;
  nonEmptyRowCount: number;
  sampleExcerpts: string[];
  existingCodeColumnNames: string[];
  proposedCodes: QualitativeCodingReviewSuggestedCode[];
  proposedAssignments: QualitativeCodingReviewProposedAssignment[];
  sourceCodebookUploadMetadataId: string | null;
  sourceCodebookOriginalFileName: string | null;
}

export interface QualitativeCodingReviewColumnDecisionInput {
  findingKey: string;
  decision: "approve_as_proposed" | "reject_for_now";
  note?: string;
}

export interface QualitativeCodingReviewColumnDecisionRecord extends QualitativeCodingReviewColumnDecisionInput {
  decidedById: string;
  decidedAt: string;
}

export interface QualitativeCodingReviewDecisions {
  columnDecisions?: QualitativeCodingReviewColumnDecisionRecord[];
}

export interface QualitativeCodingReviewDecisionsInput {
  columnDecisions?: QualitativeCodingReviewColumnDecisionInput[];
}

export interface QualitativeCodingReviewRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  status: "pending" | "approved" | "rejected";
  findings: Record<string, unknown>;
  decisions: QualitativeCodingReviewDecisions | null;
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
  "epistemic_role_clarification",
  "validated_scale_confirmation",
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

// Tracks the outcome of the post-creation LLM synthesis call
// (quantitative-only or mixed, see QuantitativeInterpretationSynthesisService)
// distinctly from "never attempted" (represented by the field being null) —
// without this, a synthesis call that failed (e.g. timed out) was
// indistinguishable from one that never applied to this dataset in the
// first place.
export const interpretationResultSynthesisStatusValues = [
  "succeeded",
  "failed",
] as const;
export type InterpretationResultSynthesisStatus =
  (typeof interpretationResultSynthesisStatusValues)[number];

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

// Who produced this value, and about whom — orthogonal to
// DatasetProfileColumnType. A deterministic calculation and a cited
// qualitative excerpt are both "grounded," but a subjective_code/free_text
// column must never be allowed to carry outcome-claim language the way a
// validated_scale or metric_count column can (see
// QUALITATIVE_MIXED_EVIDENCE_PLAN.md Section 3).
export const epistemicRoleValues = [
  "identifier",
  "temporal",
  "validated_scale",
  "metric_count",
  "subjective_code",
  "free_text",
  "flag",
  "categorical",
  "constant",
] as const;
export type EpistemicRole = (typeof epistemicRoleValues)[number];

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
  "activity_output",
  "activity_outcome",
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
  goalId?: string | null;
  prompt: string;
  kind: InterpretationQuestionKind;
  questionDomain: InterpretationQuestionDomain;
  options: string[] | null;
  recommendedOption: string | null;
  recommendedConfidence: number | null;
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
  // null when the deterministic classifier couldn't confidently decide —
  // an epistemic_role_clarification question is generated for that column
  // instead of guessing (see datasetPreparationService.ts).
  epistemicRole: EpistemicRole | null;
  // True only for a numeric+bounded+name-pattern column that looks like a
  // validated self-report scale but still needs a human-confirmed
  // validated_scale_confirmation answer before it can be treated as one.
  isValidatedScaleCandidate: boolean;
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
  epistemicRoleClarifications: DatasetPreparationDecisionSelection[];
  validatedScaleConfirmations: DatasetPreparationDecisionSelection[];
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
  // Persisted for later use by the tool-execution/assessment layers; not
  // consumed by anything yet (Phase 1a of
  // QUALITATIVE_MIXED_EVIDENCE_PLAN.md).
  epistemicRole: EpistemicRole | null;
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

export const deterministicAnalysisMetricGrainValues = [
  "row",
  "entity",
  "event",
  "source",
] as const;
export type DeterministicAnalysisMetricGrain =
  (typeof deterministicAnalysisMetricGrainValues)[number];

export const deterministicAnalysisDenominatorTypeValues = [
  "rows",
  "distinct_entities",
] as const;
export type DeterministicAnalysisDenominatorType =
  (typeof deterministicAnalysisDenominatorTypeValues)[number];

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
  grain?: DeterministicAnalysisMetricGrain;
  numerator?: number | null;
  denominator?: number | null;
  denominatorType?: DeterministicAnalysisDenominatorType;
  identifierColumn?: string | null;
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
  grain?: DeterministicAnalysisMetricGrain;
  numerator?: number | null;
  denominator?: number | null;
  denominatorType?: DeterministicAnalysisDenominatorType;
  identifierColumn?: string | null;
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

export interface LinkageEntityFieldValue {
  fieldName: string;
  value: string;
  role: PreparedDatasetColumnRole;
  isPositiveStatusField: boolean;
  sourceUploadMetadataId: string;
  sourceTableName: string;
}

export interface LinkageEntityRecord {
  entityKey: string;
  fields: LinkageEntityFieldValue[];
  sourceUploadMetadataIds: string[];
}

export interface LinkageDuplicateRowRemoval {
  uploadMetadataId: string;
  tableName: string;
  entityKey: string;
  duplicateRowCount: number;
}

export interface LinkageConflictCompetingValue {
  value: string;
  sourceUploadMetadataId: string;
  sourceTableName: string;
}

export interface LinkageConflictRecord {
  entityKey: string;
  fieldName: string;
  competingValues: LinkageConflictCompetingValue[];
  resolvedValue: string;
}

export const linkageSemanticConceptValues = [
  "suitability",
  "safeguarding",
  "background_check",
] as const;
export type LinkageSemanticConcept =
  (typeof linkageSemanticConceptValues)[number];

export const linkageSemanticSourceRoleValues = [
  "administrative_record",
  "assessment",
  "follow_up",
  "derived_signal",
  "unknown",
] as const;
export type LinkageSemanticSourceRole =
  (typeof linkageSemanticSourceRoleValues)[number];

export const linkageSemanticAssessmentOutcomeValues = [
  "consistent",
  "progression",
  "superseded",
  "true_conflict",
  "insufficient_context",
] as const;
export type LinkageSemanticAssessmentOutcome =
  (typeof linkageSemanticAssessmentOutcomeValues)[number];

export const linkageObservationDateConfidenceValues = [
  "explicit",
  "derived",
  "unknown",
] as const;
export type LinkageObservationDateConfidence =
  (typeof linkageObservationDateConfidenceValues)[number];

export interface LinkageSemanticObservationRecord {
  fieldName: string;
  value: string;
  sourceUploadMetadataId: string;
  sourceTableName: string;
  sourceRole: LinkageSemanticSourceRole;
  observedAt: string | null;
  observedAtConfidence: LinkageObservationDateConfidence;
}

export interface LinkageSemanticAssessmentRecord {
  entityKey: string;
  concept: LinkageSemanticConcept;
  outcome: LinkageSemanticAssessmentOutcome;
  resolvedValue: string | null;
  rationale: string | null;
  observations: LinkageSemanticObservationRecord[];
}

export interface LinkageCoverageDiffRecord {
  uploadMetadataIdA: string;
  uploadMetadataIdB: string;
  entityKeysOnlyInA: string[];
  entityKeysOnlyInB: string[];
}

export type ActivityEvidenceLinkageStatus = "needs_review" | "resolved";

export type ActivityEvidenceLinkageProposalDecision = "accept" | "reject";

export interface ActivityEvidenceLinkageProposalRecord {
  proposalId: string;
  uploadMetadataIdA: string;
  uploadMetadataIdB: string;
  tableNameA: string;
  tableNameB: string;
  columnNameA: string;
  columnNameB: string;
  matchBasis: "identifier_column" | "name_like_column";
  confidence: "high" | "medium";
  overlapRatio: number;
}

export interface ActivityEvidenceLinkageProposalDecisionRecord {
  proposalId: string;
  decision: ActivityEvidenceLinkageProposalDecision;
  decidedAt: string;
}

export interface LinkagePositiveStatusFieldDefinition {
  fieldName: string;
  positiveStatusValues: string[];
  sourceUploadMetadataId: string;
  sourceTableName: string;
}

export interface ActivityEvidenceLinkageGroup {
  joinKeyLabel: string;
  linkedUploadMetadataIds: string[];
  entities: LinkageEntityRecord[];
  duplicateRowsRemoved: LinkageDuplicateRowRemoval[];
  conflicts: LinkageConflictRecord[];
  semanticAssessments?: LinkageSemanticAssessmentRecord[];
  coverageDiffs: LinkageCoverageDiffRecord[];
  positiveStatusFieldDefinitions: LinkagePositiveStatusFieldDefinition[];
}

export interface ActivityEvidenceLinkageResultRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string;
  status: ActivityEvidenceLinkageStatus;
  groups: ActivityEvidenceLinkageGroup[];
  proposals: ActivityEvidenceLinkageProposalRecord[];
  proposalDecisions: ActivityEvidenceLinkageProposalDecisionRecord[];
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
  synthesisStatus: InterpretationResultSynthesisStatus | null;
  synthesisError: string | null;
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

export type ActivityAnalysisRunV2Status =
  "collected" | "running" | "needs_clarification" | "completed" | "failed";

export type ActivityAnalysisRunV2ValidationStatus =
  "not_run" | "passed" | "failed";

export const activityAnalysisV2ToolNameValues = [
  "describe_evidence",
  "excerpt_retrieval",
  "create_cohort",
  "filter_result",
  "join_tables",
  "anti_join",
  "derive_numeric_column",
  "compare_columns",
  "profile_column",
  "count_rows",
  "count_distinct",
  "count_distinct_keys",
  "group_count",
  "crosstab_count",
  "group_aggregate",
  "aggregate_numeric",
  "intersection_count",
  "intersection_set",
  "union_count",
  "union_set",
  "difference_set",
  "first_event",
  "last_event",
  "date_difference",
  "event_gap",
  "days_since_last_event",
  "period_change",
  "paired_change",
  "time_bucket_count",
  "calculate_ratio",
  "calculate_difference",
  "calculate_percent_change",
  "calculate_sum",
  "calculate_product",
  "compare_target",
] as const;
export type ActivityAnalysisV2ToolName =
  (typeof activityAnalysisV2ToolNameValues)[number];

export type ActivityAnalysisV2ToolCallStatus = "succeeded" | "failed";

export interface ActivityAnalysisV2ToolCallRecord {
  toolCallId: string;
  toolName: ActivityAnalysisV2ToolName;
  arguments: Record<string, unknown>;
  calculationIds: string[];
  qualitativeFindingIds?: string[];
  status: ActivityAnalysisV2ToolCallStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ActivityAnalysisV2CalculationRecord {
  calculationId: string;
  toolName: ActivityAnalysisV2ToolName;
  label: string;
  description: string;
  formula: string | null;
  value: number | string | boolean | null;
  unit: string | null;
  sourceUploadMetadataIds: string[];
  sourceTableNames: string[];
  sourceColumns: string[];
  sourceColumnEpistemicRoles?: Array<{
    columnName: string;
    epistemicRole: EpistemicRole | null;
  }>;
  grain?: DeterministicAnalysisMetricGrain;
  numerator?: number | null;
  denominator?: number | null;
  denominatorType?: DeterministicAnalysisDenominatorType;
  identifierColumn?: string | null;
  result: Record<string, unknown>;
}

export interface ActivityAnalysisV2QualitativeFindingRecord {
  findingId: string;
  toolName: ActivityAnalysisV2ToolName;
  label: string;
  description: string;
  themeOrCode: string | null;
  excerpts: Array<{
    sourceRowId: string | null;
    verbatimText: string;
    sourceColumn: string;
  }>;
  totalMatchingRows: number;
  excerptsReturned: number;
  frequency: {
    count: number;
    denominator: number | null;
    denominatorType: DeterministicAnalysisDenominatorType | null;
  } | null;
  codingMethod: "source_provided" | "llm_assisted_reviewed";
  reliabilitySignal: {
    missingValuePct: number | null;
    raterCount: number | "unknown" | null;
  };
  sourceUploadMetadataIds: string[];
  sourceTableNames: string[];
  sourceColumns: string[];
  sourceColumnEpistemicRoles?: Array<{
    columnName: string;
    epistemicRole: EpistemicRole | null;
  }>;
  identifierColumn: string | null;
}

export interface ActivityAnalysisV2MissingCapability {
  kind: "deterministic_calculation";
  name: string;
  reason: string;
}

export type ActivityAnalysisV2GoalAssessmentStatus =
  | "achieved"
  | "not_achieved"
  | "evidence_compiled"
  | "qualitative_evidence_only"
  | "mixed_evidence"
  | "requires_clarification"
  | "requires_capability";

export interface ActivityAnalysisV2GoalAssessmentRecord {
  goalId: string;
  goalType: "output";
  goalText: string;
  evaluationMode:
    "numeric_target" | "condition" | "directional_change" | "evidence_only";
  plannerStatus: "planned" | "requires_clarification" | "requires_capability";
  assessmentStatus: ActivityAnalysisV2GoalAssessmentStatus;
  rationale: string;
  findingText: string;
  missingCapabilities: ActivityAnalysisV2MissingCapability[];
  supportingCalculationIds: string[];
  supportingQualitativeFindingIds: string[];
  evidenceTensionFlag: boolean;
  measuredValue: number | null;
  targetValue: number | null;
  comparison: "at_least" | "at_most" | "equal" | null;
  achieved: boolean | null;
}

export interface ActivityAssessmentV2 {
  goalAssessments: ActivityAnalysisV2GoalAssessmentRecord[];
  limitations: string[];
}

export interface ActivityAnalysisV2Diagnostics {
  goalCount: number;
  outputGoalCount: number;
  evidenceCount: number;
  plannedToolRequestCount: number;
  executedToolCallCount: number;
  calculationCount: number;
  validationIssueCount: number;
  goalStatusCounts: {
    achieved: number;
    notAchieved: number;
    evidenceCompiled: number;
    qualitativeEvidenceOnly: number;
    mixedEvidence: number;
    requiresClarification: number;
    requiresCapability: number;
  };
}

export interface ActivityAnalysisRunV2GoalsSnapshot {
  activityType: string | null;
  objectives: string | null;
  output: string | null;
}

export interface ActivityAnalysisRunV2EvidenceItem {
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  logicalEvidenceId: string;
  versionNumber: number;
  originalFileName: string;
  evidenceModality: string | null;
  uploadedAt: string;
}

export interface ActivityAnalysisRunV2RunLimits {
  maxToolCalls: number;
  maxLlmIterations: number;
  timeoutMs: number;
  maxEvidenceItems: number;
}

export interface ActivityAnalysisRunV2Validation {
  status: ActivityAnalysisRunV2ValidationStatus;
  issues: string[];
}

export interface ActivityAnalysisRunV2Record {
  analysisRunId: string;
  activityId: string;
  projectId: string;
  activityName: string;
  phase: string;
  status: ActivityAnalysisRunV2Status;
  goalsSnapshot: ActivityAnalysisRunV2GoalsSnapshot;
  evidence: ActivityAnalysisRunV2EvidenceItem[];
  runLimits: ActivityAnalysisRunV2RunLimits;
  clarificationQuestions: InterpretationQuestion[];
  toolCallTrace: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
  assessment: ActivityAssessmentV2 | null;
  diagnostics: ActivityAnalysisV2Diagnostics;
  validation: ActivityAnalysisRunV2Validation;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// Project-level "impact story" dashboard — a read model over already-
// grounded ActivityAnalystV2 calculations (never recomputed here), grouped
// per activity with no cross-activity summation. See
// projectImpactStoryAssembly.ts for how tiles are derived.
export type ImpactIndicatorTileFormat = "number" | "percentage";

export interface ImpactStoryKpiTile {
  kind: "kpi";
  indicatorId: string;
  label: string;
  description: string;
  value: number | null;
  formatAs: ImpactIndicatorTileFormat;
}

export interface ImpactStoryCategoryRankTile {
  kind: "category_rank";
  indicatorId: string;
  label: string;
  description: string;
  buckets: Array<{ category: string; count: number }>;
}

export interface ImpactStoryTrendPoint {
  period: string;
  count: number | null;
  numeratorCount: number | null;
  denominatorCount: number | null;
}

export interface ImpactStoryTrendTile {
  kind: "line_series";
  indicatorId: string;
  label: string;
  description: string;
  points: ImpactStoryTrendPoint[];
}

export type ImpactIndicatorTile =
  ImpactStoryKpiTile | ImpactStoryCategoryRankTile | ImpactStoryTrendTile;

export interface ActivityImpactStoryCard {
  activityId: string;
  activityName: string;
  tiles: ImpactIndicatorTile[];
}

export interface ProjectImpactStorySourceSnapshotItem {
  activityId: string;
  activityAnalysisRunId: string;
}

export interface ProjectImpactStoryDiagnostics {
  activityCount: number;
  indicatorCount: number;
  excludedIndicatorCount: number;
  activitiesWithNoGroundedIndicators: string[];
}

export type ProjectImpactStoryStatus = "completed" | "failed";

// Project-level headline KPIs and chart plan — the LLM-planned, backend-
// executed story layer on top of activityCards (see
// projectImpactStoryChartPlanExecution.ts). Every `value`/`data` field here
// is computed entirely by ia_backend from real catalog entries; the LLM
// only ever nominates which catalog entries to feature and how to group
// them (see ia_python_service/CLAUDE.md's chart-plan route documentation).
export interface ProjectImpactStoryHeadlineKpi {
  kpiId: string;
  label: string;
  value: number;
  formatAs: ImpactIndicatorTileFormat;
  narrativeReason: string;
}

export type ProjectImpactStoryChartType =
  "bar" | "pie" | "line" | "comparison" | "distribution";

export interface ProjectImpactStoryChartDatum {
  label: string;
  value: number;
}

// What each ProjectImpactStoryChartDatum.label actually means, set
// deterministically by which of executeProjectImpactStoryChartPlan's data-
// building branches produced it (see projectImpactStoryChartPlanExecution.ts)
// — never inferred by the frontend from the label text. "status" datums use
// ActivityAnalysisV2GoalAssessmentStatus values as their label and should be
// rendered with the reserved status palette + a legend, since each segment
// is a genuinely distinct identity a viewer needs to recognize; the other
// three kinds are the same measure repeated across categories/periods/
// activities and should stay single-hue, per "color follows the entity,
// never its rank."
export type ProjectImpactStoryChartDataKind =
  "category" | "period" | "status" | "activity";

export interface ProjectImpactStoryChartSpec {
  chartId: string;
  chartType: ProjectImpactStoryChartType;
  dataKind: ProjectImpactStoryChartDataKind;
  valueFormat: ImpactIndicatorTileFormat;
  title: string;
  subtitle: string | null;
  narrativeReason: string;
  data: ProjectImpactStoryChartDatum[];
}

export interface ProjectImpactStoryRecord {
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
  createdAt: string;
  updatedAt: string;
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
  expiresInSeconds: number;
  user: UserSummary;
  organizations: OrganizationSummary[];
}

export interface StartEvidenceAnalysisResponse {
  job: ProcessingJobRecord;
}

export interface ApprovePrivacyReviewResponse {
  review: PrivacyReviewRecord;
  job: ProcessingJobRecord;
}

export interface GenerateQualitativeCodingReviewResponse {
  review: QualitativeCodingReviewRecord;
}

export interface ApproveQualitativeCodingReviewResponse {
  review: QualitativeCodingReviewRecord;
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
