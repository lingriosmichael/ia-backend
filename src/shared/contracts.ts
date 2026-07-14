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

export const resultRecordStatusValues = [
  "pending",
  "available",
  "archived",
] as const;
export type ResultRecordStatus = (typeof resultRecordStatusValues)[number];
export const aiArtifactStatusValues = resultRecordStatusValues;
export type AIArtifactStatus = ResultRecordStatus;

export const resultRecordTypeValues = [
  "semantic_summary",
  "activity_snapshot",
  "project_snapshot",
  "other",
] as const;
export type ResultRecordType = (typeof resultRecordTypeValues)[number];
export const aiArtifactTypeValues = resultRecordTypeValues;
export type AIArtifactType = ResultRecordType;

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

export interface ResultRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  resultType: AIArtifactType;
  status: AIArtifactStatus;
  payload: Record<string, unknown> | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}
export type AIArtifactRecord = ResultRecord;

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

export const privacyReviewDecisionValueValues = [
  "approved",
  "rejected",
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
  sourceFileName: string | null;
  extension: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  tableCount: number;
  paragraphCount: number;
  tables: ParsedRepresentationPreviewTable[];
  paragraphs: ParsedRepresentationPreviewParagraph[];
}

// What the client sends when approving a review: which finding, which
// choice. Never includes who/when — that's stamped server-side (see
// PrivacyReviewFieldDecisionRecord) so it can't be spoofed by the caller.
//
// `reason` is required (non-empty) whenever decision is "rejected" — a
// reviewer overriding a privacy finding (choosing to keep PII unredacted)
// must justify it for the audit trail. This is enforced at the validation
// boundary (see approvePrivacyReviewSchema), not just here in the type.
export interface PrivacyReviewFieldDecisionInput {
  field: string;
  entityType: string;
  decision: PrivacyReviewDecisionValue;
  reason?: string;
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

export const interpretationQuestionStatusValues = [
  "pending",
  "answered",
] as const;
export type InterpretationQuestionStatus =
  (typeof interpretationQuestionStatusValues)[number];

export const interpretationWarningSeverityValues = ["info", "warning"] as const;
export type InterpretationWarningSeverity =
  (typeof interpretationWarningSeverityValues)[number];

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
  relationToEvidence: InterpretationQualitativeFindingRelation;
  status: InterpretationIndicatorStatus;
}

export interface InterpretationQuestion {
  id: string;
  prompt: string;
  kind: InterpretationQuestionKind;
  options: string[] | null;
  isBlocking: boolean;
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

export interface InterpretationGoalCoverage {
  id: string;
  goalSummary: string;
  isSupportedByData: boolean;
  relatedIndicatorIds: string[];
  gapExplanation: string | null;
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
  entities: InterpretationEntity[];
  indicators: InterpretationIndicator[];
  relationships: InterpretationRelationship[];
  qualitativeFindings: InterpretationQualitativeFinding[];
  supportingQuotes: InterpretationSupportingQuote[];
  questions: InterpretationQuestion[];
  warnings: InterpretationWarning[];
  goalAlignment: InterpretationGoalCoverage[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInterpretationOverview {
  results: InterpretationResultRecord[];
}

export interface StartInterpretationResponse {
  job: ProcessingJobRecord;
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
  resultCount: number;
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

export interface CreateResultRecordRequest {
  activityId?: string | null;
  uploadMetadataId?: string | null;
  processingJobId?: string | null;
  resultType: ResultRecordType;
  payload?: Record<string, unknown>;
}
export type CreateAIArtifactRequest = CreateResultRecordRequest;

export interface UpdateResultRecordRequest {
  status?: ResultRecordStatus;
  payload?: Record<string, unknown> | null;
}
export type UpdateAIArtifactRequest = UpdateResultRecordRequest;

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

export const knowledgeRelationshipTypeValues = [
  "attended",
  "completed",
  "observed_in",
  "reinforces",
  "contradicts",
  "complicates",
] as const;
export type KnowledgeRelationshipType =
  (typeof knowledgeRelationshipTypeValues)[number];

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

export interface KnowledgeSourceInstance {
  uploadMetadataId: string;
  interpretationResultId: string;
  activityId: string;
  activityType: string | null;
  sourceReference: string;
  addedAt: string;
  computedValue?: KnowledgeSourceInstanceComputedValue | null;
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
