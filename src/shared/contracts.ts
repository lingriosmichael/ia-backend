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
  "completed",
  "failed",
  "cancelled",
] as const;
export type ProcessingJobStatus = (typeof processingJobStatusValues)[number];
export const aiExecutionStatusValues = processingJobStatusValues;
export type AIExecutionStatus = ProcessingJobStatus;

export const processingJobTypeValues = [
  "semantic_ingestion",
  "manual_review",
  "export",
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
  settings: OrganizationSettings;
  role: OrganizationRole;
  permissions: OrganizationPermissions;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  description: string | null;
  programGoal: string | null;
  startMonth: string | null;
  endMonth: string | null;
  country: string | null;
  regionCity: string | null;
  sdgs: string[];
  targetBeneficiaries: string[];
  fundingSource: string | null;
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
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  status: UploadMetadataStatus;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIExecutionRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  jobType: AIExecutionType;
  status: AIExecutionStatus;
  triggeredById: string;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export type ProcessingJobRecord = AIExecutionRecord;

export interface AIArtifactRecord {
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
export type ResultRecord = AIArtifactRecord;

export interface ActivityUploadResponse {
  upload: UploadMetadataRecord;
  execution: AIExecutionRecord;
  job: ProcessingJobRecord;
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
  description?: string;
  programGoal?: string;
  startMonth?: string;
  endMonth?: string;
  country?: string;
  regionCity?: string;
  sdgs?: string[];
  targetBeneficiaries?: string[];
  fundingSource?: string;
  status?: ProjectStatus;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  programGoal?: string | null;
  startMonth?: string | null;
  endMonth?: string | null;
  country?: string | null;
  regionCity?: string | null;
  sdgs?: string[];
  targetBeneficiaries?: string[];
  fundingSource?: string | null;
  status?: ProjectStatus;
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
}

export interface UpdateUploadMetadataRequest {
  contentType?: string | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
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
