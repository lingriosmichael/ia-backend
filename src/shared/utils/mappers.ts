import type {
  ActivitySummary,
  ActivityStatus,
  AIArtifactStatus,
  AIArtifactType,
  AIExecutionStatus,
  AIExecutionType,
  AuthResponse,
  OrganizationSummary,
  OrganizationRole,
  OrganizationWorkspace,
  ProcessingJobRecord,
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
  OWNER: "owner",
  MEMBER: "member",
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
  value: OrganizationRole | keyof typeof organizationRoleMap,
): OrganizationRole {
  if (value === "owner" || value === "member") {
    return value;
  }

  return organizationRoleMap[value];
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
    slug: string;
    description?: string | null;
    logoPath?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}): OrganizationSummary {
  return {
    id: record.organization.id,
    name: record.organization.name,
    slug: record.organization.slug,
    description: record.organization.description ?? null,
    logoUrl: record.organization.logoPath
      ? `/organizations/${record.organization.id}/logo`
      : null,
    role: normalizeOrganizationRole(record.role),
    createdAt: toIso(record.organization.createdAt),
    updatedAt: toIso(record.organization.updatedAt),
  };
}

export function mapProject(project: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  programGoal: string | null;
  startMonth: string | null;
  endMonth: string | null;
  country: string | null;
  regionCity: string | null;
  sdgs: string[];
  targetBeneficiaries: string[];
  fundingSource: string | null;
  status: ProjectStatus | keyof typeof projectStatusMap;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceProject {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    programGoal: project.programGoal,
    startMonth: project.startMonth,
    endMonth: project.endMonth,
    country: project.country,
    regionCity: project.regionCity,
    sdgs: project.sdgs,
    targetBeneficiaries: project.targetBeneficiaries,
    fundingSource: project.fundingSource,
    status: normalizeProjectStatus(project.status),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
    activities: [],
  };
}

export function mapProjectSummary(project: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  programGoal: string | null;
  startMonth: string | null;
  endMonth: string | null;
  country: string | null;
  regionCity: string | null;
  sdgs: string[];
  targetBeneficiaries: string[];
  fundingSource: string | null;
  status: ProjectStatus | keyof typeof projectStatusMap;
  createdAt: Date;
  updatedAt: Date;
}): ProjectSummary {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    programGoal: project.programGoal,
    startMonth: project.startMonth,
    endMonth: project.endMonth,
    country: project.country,
    regionCity: project.regionCity,
    sdgs: project.sdgs,
    targetBeneficiaries: project.targetBeneficiaries,
    fundingSource: project.fundingSource,
    status: normalizeProjectStatus(project.status),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
  };
}

export function mapActivity(activity: {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  activityType: string | null;
  owner: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  expectedOutcomes: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  beneficiaryGroup: string | null;
  status: ActivityStatus | keyof typeof activityStatusMap;
  createdAt: Date;
  updatedAt: Date;
}): ActivitySummary {
  return {
    id: activity.id,
    projectId: activity.projectId,
    name: activity.name,
    slug: activity.slug,
    description: activity.description,
    activityType: activity.activityType,
    owner: activity.owner,
    startDate: activity.startDate ? toIso(activity.startDate) : null,
    endDate: activity.endDate ? toIso(activity.endDate) : null,
    objectives: activity.objectives,
    expectedOutcomes: activity.expectedOutcomes,
    successIndicators: activity.successIndicators,
    targetAudience: activity.targetAudience,
    beneficiaryGroup: activity.beneficiaryGroup,
    status: normalizeActivityStatus(activity.status),
    createdAt: toIso(activity.createdAt),
    updatedAt: toIso(activity.updatedAt),
  };
}

export function mapWorkspaceActivity(activity: {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  activityType: string | null;
  owner: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  expectedOutcomes: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  beneficiaryGroup: string | null;
  status: ActivityStatus | keyof typeof activityStatusMap;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    uploadMetadata: number;
    processingJobs: number;
    resultRecords: number;
  };
}): WorkspaceActivity {
  return {
    ...mapActivity(activity),
    uploadMetadataCount: activity._count.uploadMetadata,
    processingJobCount: activity._count.processingJobs,
    resultCount: activity._count.resultRecords,
  };
}

export function mapWorkspace(record: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoPath: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberships: Array<{ role: OrganizationRole | keyof typeof organizationRoleMap }>;
  projects: Array<{
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    programGoal: string | null;
    startMonth: string | null;
    endMonth: string | null;
    country: string | null;
    regionCity: string | null;
    sdgs: string[];
    targetBeneficiaries: string[];
    fundingSource: string | null;
    status: ProjectStatus | keyof typeof projectStatusMap;
    createdAt: Date;
    updatedAt: Date;
    activities: Array<{
      id: string;
      projectId: string;
      name: string;
      slug: string;
      description: string | null;
      activityType: string | null;
      owner: string | null;
      startDate: Date | null;
      endDate: Date | null;
      objectives: string | null;
      expectedOutcomes: string | null;
      successIndicators: string | null;
      targetAudience: string | null;
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
  const role = record.memberships[0]?.role ?? "member";

  return {
    organization: {
      id: record.id,
      name: record.name,
      slug: record.slug,
      description: record.description,
      logoUrl: record.logoPath ? `/organizations/${record.id}/logo` : null,
      role: normalizeOrganizationRole(role),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
    },
    projects: record.projects.map((project) => ({
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      programGoal: project.programGoal,
      startMonth: project.startMonth,
      endMonth: project.endMonth,
      country: project.country,
      regionCity: project.regionCity,
      sdgs: project.sdgs,
      targetBeneficiaries: project.targetBeneficiaries,
      fundingSource: project.fundingSource,
      status: normalizeProjectStatus(project.status),
      createdAt: toIso(project.createdAt),
      updatedAt: toIso(project.updatedAt),
      activities: project.activities.map(mapWorkspaceActivity),
    })),
  };
}

export function mapUploadMetadata(record: {
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
  createdAt: Date;
  updatedAt: Date;
}): UploadMetadataRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    activityId: record.activityId,
    originalFileName: record.originalFileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    storageKey: record.storageKey,
    status: record.status,
    uploadedById: record.uploadedById,
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
  jobType: AIExecutionType;
  status: AIExecutionStatus;
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
      slug: string;
      description?: string | null;
      logoPath?: string | null;
      createdAt: Date;
      updatedAt: Date;
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
