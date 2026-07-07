export const organizationRoleValues = [
  "ORGANIZATION_ADMIN",
  "PROJECT_MANAGER",
] as const;
export type OrganizationRole = (typeof organizationRoleValues)[number];

export const projectStatusValues = ["planning", "active", "completed"] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

export const activityStatusValues = [
  "planning",
  "active",
  "completed",
] as const;
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
  expectedOutcomes: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  additionalContext: string | null;
  beneficiaryGroup: string | null;
  status: ActivityStatus;
  permissions: ActivityPermissions;
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
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const privacyReviewDecisionValueValues = [
  "exclude",
  "continue_with_restriction",
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
  sourceFileName: string | null;
  extension: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  tableCount: number;
  paragraphCount: number;
  tables: ParsedRepresentationPreviewTable[];
  paragraphs: ParsedRepresentationPreviewParagraph[];
}

export interface PrivacyReviewDecisions {
  defaults?: {
    freeTextRisk?: PrivacyReviewDecisionValue;
    specialCategoryData?: PrivacyReviewDecisionValue;
  };
  fieldDecisions?: Array<{
    field: string;
    entityType: "FREE_TEXT_RISK" | "SPECIAL_CATEGORY_DATA";
    decision: PrivacyReviewDecisionValue;
  }>;
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
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  expectedOutcomes?: string;
  successIndicators?: string;
  targetAudience?: string;
  additionalContext?: string;
  beneficiaryGroup?: string;
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
  expectedOutcomes?: string | null;
  successIndicators?: string | null;
  targetAudience?: string | null;
  additionalContext?: string | null;
  beneficiaryGroup?: string | null;
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
