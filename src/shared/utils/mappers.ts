import type {
  ActivitySummary,
  ActivityStatus,
  ActivityPermissions,
  AIArtifactStatus,
  AIArtifactType,
  AuthResponse,
  OrganizationSettings,
  OrganizationPermissions,
  OrganizationSummary,
  OrganizationRole,
  OrganizationWorkspace,
  ParsedRepresentationPreviewRecord,
  ParsedRepresentationRecord,
  ProcessingJobStatus,
  ProjectPermissions,
  ProcessingJobType,
  ProcessingJobRecord,
  PrivacyReviewDecisions,
  PrivacyReviewRecord,
  PrivacySafeRepresentationRecord,
  ProjectStatus,
  ProjectSummary,
  ResultRecord,
  UploadMetadataStatus,
  UploadMetadataRecord,
  UserSummary,
  WorkspaceActivity,
  WorkspaceProject,
} from "../contracts.js";

const organizationRoleMap = {
  OWNER: "ORGANIZATION_ADMIN",
  MEMBER: "PROJECT_MANAGER",
} as const;

const projectStatusMap = {
  DRAFT: "planning",
  ACTIVE: "active",
  ARCHIVED: "completed",
} as const;

const activityStatusMap = {
  DRAFT: "planning",
  ACTIVE: "active",
  ARCHIVED: "completed",
} as const;

function toIso(value: Date): string {
  return value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeActivityStatus(
  value: ActivityStatus | keyof typeof activityStatusMap,
): ActivityStatus {
  return value === "planning" || value === "active" || value === "completed"
    ? value
    : activityStatusMap[value];
}

function normalizeProjectStatus(
  value: ProjectStatus | keyof typeof projectStatusMap,
): ProjectStatus {
  if (value === "planning" || value === "active" || value === "completed") {
    return value;
  }

  return projectStatusMap[value];
}

function normalizeOrganizationRole(
  value:
    OrganizationRole | keyof typeof organizationRoleMap | "owner" | "member",
): OrganizationRole {
  if (value === "ORGANIZATION_ADMIN" || value === "PROJECT_MANAGER") {
    return value;
  }

  if (value === "owner") {
    return "ORGANIZATION_ADMIN";
  }

  if (value === "member") {
    return "PROJECT_MANAGER";
  }

  return organizationRoleMap[value];
}

function mapOrganizationPermissions(
  role: OrganizationRole,
): OrganizationPermissions {
  return {
    canManageMembers: role === "ORGANIZATION_ADMIN",
    canManageBilling: role === "ORGANIZATION_ADMIN",
    canManageSettings: role === "ORGANIZATION_ADMIN",
    canCreateProject: true,
  };
}

function mapProjectPermissions(
  ownerId: string,
  currentUserId: string,
): ProjectPermissions {
  const canEdit = ownerId === currentUserId;

  return {
    canEdit,
    canDelete: canEdit,
    canCreateActivity: canEdit,
    canUploadEvidence: canEdit,
  };
}

function mapActivityPermissions(
  projectOwnerId: string,
  currentUserId: string,
): ActivityPermissions {
  const canEdit = projectOwnerId === currentUserId;

  return {
    canEdit,
    canUploadEvidence: canEdit,
  };
}

export function mapUser(user: {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
  updatedAt: Date;
}): UserSummary {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
  };
}

export function mapOrganizationMembership(record: {
  role: OrganizationRole | keyof typeof organizationRoleMap;
  organization: {
    id: string;
    name: string;
    mission?: string | null;
    logoUrl?: string | null;
    memberCount?: number | null;
    settings: OrganizationSettings;
    createdAt: Date;
  };
}): OrganizationSummary {
  const normalizedRole = normalizeOrganizationRole(record.role);

  return {
    id: record.organization.id,
    name: record.organization.name,
    mission: record.organization.mission ?? null,
    logoUrl: record.organization.logoUrl
      ? `/organizations/${record.organization.id}/logo`
      : null,
    memberCount: record.organization.memberCount ?? null,
    settings: record.organization.settings,
    role: normalizedRole,
    permissions: mapOrganizationPermissions(normalizedRole),
    createdAt: toIso(record.organization.createdAt),
  };
}

export function mapProject(
  project: {
    id: string;
    organizationId: string;
    ownerId: string;
    ownerName?: string | null;
    name: string;
    startMonth: string | null;
    endMonth: string | null;
    fundingProgram: string | null;
    fundingOrganization: string | null;
    targetGroups: string[];
    areaOfOperation: string | null;
    partnerships: string | null;
    sdgs: string[];
    impactModel: {
      inputs: string | null;
      activities: string | null;
      outputs: string | null;
      impact: string | null;
      outcomes: string | null;
    };
    successIndicators: string | null;
    status: ProjectStatus | keyof typeof projectStatusMap;
    createdAt: Date;
    updatedAt: Date;
  },
  currentUserId: string,
): WorkspaceProject {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ownerId: project.ownerId,
    ownerName: project.ownerName ?? null,
    name: project.name,
    startMonth: project.startMonth,
    endMonth: project.endMonth,
    fundingProgram: project.fundingProgram,
    fundingOrganization: project.fundingOrganization,
    targetGroups: project.targetGroups,
    areaOfOperation: project.areaOfOperation,
    partnerships: project.partnerships,
    sdgs: project.sdgs,
    impactModel: project.impactModel,
    successIndicators: project.successIndicators,
    status: normalizeProjectStatus(project.status),
    permissions: mapProjectPermissions(project.ownerId, currentUserId),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
    activities: [],
  };
}

export function mapProjectSummary(
  project: {
    id: string;
    organizationId: string;
    ownerId: string;
    ownerName?: string | null;
    name: string;
    startMonth: string | null;
    endMonth: string | null;
    fundingProgram: string | null;
    fundingOrganization: string | null;
    targetGroups: string[];
    areaOfOperation: string | null;
    partnerships: string | null;
    sdgs: string[];
    impactModel: {
      inputs: string | null;
      activities: string | null;
      outputs: string | null;
      impact: string | null;
      outcomes: string | null;
    };
    successIndicators: string | null;
    status: ProjectStatus | keyof typeof projectStatusMap;
    createdAt: Date;
    updatedAt: Date;
  },
  currentUserId: string,
): ProjectSummary {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ownerId: project.ownerId,
    ownerName: project.ownerName ?? null,
    name: project.name,
    startMonth: project.startMonth,
    endMonth: project.endMonth,
    fundingProgram: project.fundingProgram,
    fundingOrganization: project.fundingOrganization,
    targetGroups: project.targetGroups,
    areaOfOperation: project.areaOfOperation,
    partnerships: project.partnerships,
    sdgs: project.sdgs,
    impactModel: project.impactModel,
    successIndicators: project.successIndicators,
    status: normalizeProjectStatus(project.status),
    permissions: mapProjectPermissions(project.ownerId, currentUserId),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
  };
}

export function mapActivity(
  activity: {
    id: string;
    projectId: string;
    projectOwnerId: string;
    name: string;
    description: string | null;
    activityType: string | null;
    owner: string | null;
    startDate: Date | null;
    endDate: Date | null;
    objectives: string | null;
    expectedOutcomes: string | null;
    successIndicators: string | null;
    targetAudience: string | null;
    additionalContext: string | null;
    beneficiaryGroup: string | null;
    status: ActivityStatus | keyof typeof activityStatusMap;
    createdAt: Date;
    updatedAt: Date;
  },
  currentUserId: string,
): ActivitySummary {
  return {
    id: activity.id,
    projectId: activity.projectId,
    name: activity.name,
    description: activity.description,
    activityType: activity.activityType,
    owner: activity.owner,
    startDate: activity.startDate ? toIso(activity.startDate) : null,
    endDate: activity.endDate ? toIso(activity.endDate) : null,
    objectives: activity.objectives,
    expectedOutcomes: activity.expectedOutcomes,
    successIndicators: activity.successIndicators,
    targetAudience: activity.targetAudience,
    additionalContext: activity.additionalContext,
    beneficiaryGroup: activity.beneficiaryGroup,
    status: normalizeActivityStatus(activity.status),
    permissions: mapActivityPermissions(activity.projectOwnerId, currentUserId),
    createdAt: toIso(activity.createdAt),
    updatedAt: toIso(activity.updatedAt),
  };
}

export function mapWorkspaceActivity(
  activity: {
    id: string;
    projectId: string;
    projectOwnerId: string;
    name: string;
    description: string | null;
    activityType: string | null;
    owner: string | null;
    startDate: Date | null;
    endDate: Date | null;
    objectives: string | null;
    expectedOutcomes: string | null;
    successIndicators: string | null;
    targetAudience: string | null;
    additionalContext: string | null;
    beneficiaryGroup: string | null;
    status: ActivityStatus | keyof typeof activityStatusMap;
    createdAt: Date;
    updatedAt: Date;
    _count: {
      uploadMetadata: number;
      processingJobs: number;
      resultRecords: number;
    };
  },
  currentUserId: string,
): WorkspaceActivity {
  return {
    ...mapActivity(activity, currentUserId),
    uploadMetadataCount: activity._count.uploadMetadata,
    processingJobCount: activity._count.processingJobs,
    resultCount: activity._count.resultRecords,
  };
}

export function mapWorkspace(record: {
  currentUserId: string;
  id: string;
  name: string;
  mission: string | null;
  logoUrl: string | null;
  memberCount: number;
  settings: OrganizationSettings;
  createdAt: Date;
  memberships: Array<{
    role: OrganizationRole | keyof typeof organizationRoleMap;
  }>;
  projects: Array<{
    id: string;
    organizationId: string;
    ownerId: string;
    ownerName?: string | null;
    name: string;
    startMonth: string | null;
    endMonth: string | null;
    fundingProgram: string | null;
    fundingOrganization: string | null;
    targetGroups: string[];
    areaOfOperation: string | null;
    partnerships: string | null;
    sdgs: string[];
    impactModel: {
      inputs: string | null;
      activities: string | null;
      outputs: string | null;
      impact: string | null;
      outcomes: string | null;
    };
    successIndicators: string | null;
    status: ProjectStatus | keyof typeof projectStatusMap;
    createdAt: Date;
    updatedAt: Date;
    activities: Array<{
      id: string;
      projectId: string;
      projectOwnerId: string;
      name: string;
      description: string | null;
      activityType: string | null;
      owner: string | null;
      startDate: Date | null;
      endDate: Date | null;
      objectives: string | null;
      expectedOutcomes: string | null;
      successIndicators: string | null;
      targetAudience: string | null;
      additionalContext: string | null;
      beneficiaryGroup: string | null;
      status: ActivityStatus | keyof typeof activityStatusMap;
      createdAt: Date;
      updatedAt: Date;
      _count: {
        processingJobs: number;
        resultRecords: number;
        uploadMetadata: number;
      };
    }>;
  }>;
}): OrganizationWorkspace {
  const role = normalizeOrganizationRole(
    record.memberships[0]?.role ?? "PROJECT_MANAGER",
  );

  return {
    organization: {
      id: record.id,
      name: record.name,
      mission: record.mission,
      logoUrl: record.logoUrl ? `/organizations/${record.id}/logo` : null,
      memberCount: record.memberCount,
      settings: record.settings,
      role,
      permissions: mapOrganizationPermissions(role),
      createdAt: toIso(record.createdAt),
    },
    projects: record.projects.map((project) => ({
      id: project.id,
      organizationId: project.organizationId,
      ownerId: project.ownerId,
      ownerName: project.ownerName ?? null,
      name: project.name,
      startMonth: project.startMonth,
      endMonth: project.endMonth,
      fundingProgram: project.fundingProgram,
      fundingOrganization: project.fundingOrganization,
      targetGroups: project.targetGroups,
      areaOfOperation: project.areaOfOperation,
      partnerships: project.partnerships,
      sdgs: project.sdgs,
      impactModel: project.impactModel,
      successIndicators: project.successIndicators,
      status: normalizeProjectStatus(project.status),
      permissions: mapProjectPermissions(project.ownerId, record.currentUserId),
      createdAt: toIso(project.createdAt),
      updatedAt: toIso(project.updatedAt),
      activities: project.activities.map((activity) =>
        mapWorkspaceActivity(activity, record.currentUserId),
      ),
    })),
  };
}

export function mapUploadMetadata(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  logicalEvidenceId: string;
  versionNumber: number;
  replacesUploadMetadataId: string | null;
  supersededAt: Date | null;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  originalFileDeletedAt: Date | null;
  status: UploadMetadataStatus;
  uploadedById: string;
  uploadedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UploadMetadataRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    logicalEvidenceId: record.logicalEvidenceId,
    versionNumber: record.versionNumber,
    replacesUploadMetadataId: record.replacesUploadMetadataId,
    supersededAt: record.supersededAt ? toIso(record.supersededAt) : null,
    originalFileName: record.originalFileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    storageKey: record.storageKey,
    originalFileDeletedAt: record.originalFileDeletedAt
      ? toIso(record.originalFileDeletedAt)
      : null,
    status: record.status,
    uploadedById: record.uploadedById,
    uploadedByName: record.uploadedByName ?? null,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function mapProcessingJob(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  jobType: ProcessingJobType;
  status: ProcessingJobStatus;
  triggeredById: string;
  payload: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): ProcessingJobRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    jobType: record.jobType,
    status: record.status,
    triggeredById: record.triggeredById,
    payload: (record.payload as Record<string, unknown> | null) ?? null,
    errorMessage: record.errorMessage,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    startedAt: record.startedAt ? toIso(record.startedAt) : null,
    completedAt: record.completedAt ? toIso(record.completedAt) : null,
  };
}

export function mapResultRecord(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string | null;
  processingJobId: string | null;
  createdById: string;
  resultType: AIArtifactType;
  status: AIArtifactStatus;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ResultRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    processingJobId: record.processingJobId,
    createdById: record.createdById,
    resultType: record.resultType,
    status: record.status,
    payload: (record.payload as Record<string, unknown> | null) ?? null,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function mapParsedRepresentation(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  fileType: "spreadsheet" | "document" | "unknown";
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ParsedRepresentationRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    processingJobId: record.processingJobId,
    fileType: record.fileType,
    payload: (record.payload as Record<string, unknown>) ?? {},
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function mapParsedRepresentationPreview(record: {
  fileType: "spreadsheet" | "document" | "unknown";
  payload: unknown;
}): ParsedRepresentationPreviewRecord {
  const payload = asRecord(record.payload);
  const metadata = asRecord(payload.metadata);
  const tables = asRecordArray(payload.tables);
  const paragraphs = asRecordArray(payload.paragraphs);

  return {
    fileType: record.fileType,
    sourceFileName: readString(metadata.sourceFileName),
    extension: readString(metadata.extension),
    contentType: readString(metadata.contentType),
    fileSizeBytes: readNumber(metadata.fileSizeBytes),
    tableCount: tables.length,
    paragraphCount: paragraphs.length,
    tables: tables.slice(0, 10).map((table, index) => ({
      name: readString(table.name) ?? `table_${index + 1}`,
      rowCount: readNumber(table.rowCount) ?? 0,
      columnCount: readStringArray(table.columns).length,
      columns: readStringArray(table.columns).slice(0, 20),
    })),
    paragraphs: paragraphs.slice(0, 10).map((paragraph, index) => ({
      index: readNumber(paragraph.index) ?? index,
      page: readNumber(paragraph.page),
      sourceIndex: readNumber(paragraph.sourceIndex),
      characterCount: readString(paragraph.text)?.length ?? 0,
    })),
  };
}

export function mapPrivacyReview(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  status: "pending" | "approved" | "rejected";
  findings: unknown;
  parsedRepresentationPreview: ParsedRepresentationPreviewRecord | null;
  decisions: unknown;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PrivacyReviewRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    processingJobId: record.processingJobId,
    status: record.status,
    findings: (record.findings as Record<string, unknown>) ?? {},
    parsedRepresentationPreview: record.parsedRepresentationPreview,
    decisions: (record.decisions as PrivacyReviewDecisions | null) ?? null,
    approvedById: record.approvedById,
    approvedAt: record.approvedAt ? toIso(record.approvedAt) : null,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function mapPrivacySafeRepresentation(record: {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  processingJobId: string;
  privacyReviewId: string;
  parsedRepresentationId: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PrivacySafeRepresentationRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    uploadMetadataId: record.uploadMetadataId,
    processingJobId: record.processingJobId,
    privacyReviewId: record.privacyReviewId,
    parsedRepresentationId: record.parsedRepresentationId,
    payload: (record.payload as Record<string, unknown>) ?? {},
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function mapAuthResponse(params: {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    fullName: string;
    createdAt: Date;
    updatedAt: Date;
  };
  organizations: Array<{
    role: OrganizationRole | keyof typeof organizationRoleMap;
    organization: {
      id: string;
      name: string;
      mission?: string | null;
      logoUrl?: string | null;
      settings: OrganizationSettings;
      createdAt: Date;
    };
  }>;
}): AuthResponse {
  return {
    accessToken: params.accessToken,
    expiresInSeconds: params.expiresInSeconds,
    user: mapUser(params.user),
    organizations: params.organizations.map(mapOrganizationMembership),
  };
}
