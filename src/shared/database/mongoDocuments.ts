export type DocumentId = string;

export interface BaseDocument {
  _id: DocumentId;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDocument extends BaseDocument {
  email: string;
  fullName: string;
  passwordHash: string;
}

export interface OrganizationDocument {
  _id: DocumentId;
  name: string;
  mission: string | null;
  logoUrl: string | null;
  settings: {
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
  } | null;
  createdAt: Date;
}

export interface MembershipDocument extends BaseDocument {
  userId: DocumentId;
  organizationId: DocumentId;
  role: "ORGANIZATION_ADMIN" | "PROJECT_MANAGER";
}

export interface InvitationDocument extends BaseDocument {
  organizationId: DocumentId;
  email: string;
  role: "PROJECT_MANAGER";
  token: string;
  status: "pending" | "accepted" | "revoked";
  invitedById: DocumentId;
  acceptedById: DocumentId | null;
  acceptedAt: Date | null;
}

export interface SubscriptionDocument extends BaseDocument {
  organizationId: DocumentId;
  planName: string;
  includedAdminSeats: number;
  includedProjectManagerSeats: number;
  status: string;
}

export interface ProjectDocument extends BaseDocument {
  organizationId: DocumentId;
  ownerId: DocumentId;
  name: string;
  projectGoal: string | null;
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
  status: "planning" | "active" | "completed";
}

export interface ActivityDocument extends BaseDocument {
  projectId: DocumentId;
  createdById: DocumentId;
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
  status: "planning" | "active" | "completed";
}

export interface UploadDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadedById: DocumentId;
  logicalEvidenceId: DocumentId;
  versionNumber: number;
  replacesUploadMetadataId: DocumentId | null;
  supersededAt: Date | null;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  originalFileDeletedAt: Date | null;
  status: "pending" | "uploaded" | "archived";
}

export interface ProcessingJobDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadMetadataId: DocumentId | null;
  triggeredById: DocumentId;
  jobType:
    | "evidence_processing"
    | "dataset_interpretation"
    | "dataset_review"
    | "metrics_generation"
    | "dashboard_generation"
    | "insight_generation"
    | "report_generation"
    | "chat"
    | "other";
  status:
    | "queued"
    | "processing"
    | "awaiting_privacy_review"
    | "transforming"
    | "completed"
    | "failed"
    | "cancelled";
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}
export type AIExecutionDocument = ProcessingJobDocument;

export interface ParsedRepresentationDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadMetadataId: DocumentId;
  processingJobId: DocumentId;
  fileType: "spreadsheet" | "document" | "unknown";
  payload: Record<string, unknown>;
}

export interface PrivacyReviewDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadMetadataId: DocumentId;
  processingJobId: DocumentId;
  status: "pending" | "approved" | "rejected";
  findings: Record<string, unknown>;
  decisions: Record<string, unknown> | null;
  approvedById: DocumentId | null;
  approvedAt: Date | null;
}

export interface PrivacySafeRepresentationDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadMetadataId: DocumentId;
  processingJobId: DocumentId;
  privacyReviewId: DocumentId;
  parsedRepresentationId: DocumentId;
  payload: Record<string, unknown>;
}

export interface EntityMappingDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadMetadataId: DocumentId;
  processingJobId: DocumentId;
  entityType: string;
  payload: Record<string, unknown>;
}

export interface DatasetInterpretationDocument extends BaseDocument {
  executionId: DocumentId;
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadId: DocumentId;
  summary: Record<string, unknown>;
  findings: Record<string, unknown>[];
  privacyRisks: Record<string, unknown>[];
  schemaUnderstanding: Record<string, unknown>;
  recommendations: Record<string, unknown>[];
  confidence: number | null;
}

export interface AnalysisDocument extends BaseDocument {
  executionId: DocumentId;
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadId: DocumentId | null;
  metrics: Record<string, unknown>;
  charts: Record<string, unknown>[];
  trends: Record<string, unknown>[];
  recommendations: Record<string, unknown>[];
  confidence: number | null;
}

export interface InsightDocument extends BaseDocument {
  executionId: DocumentId;
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  analysisId: DocumentId | null;
  summary: Record<string, unknown>;
  findings: Record<string, unknown>[];
  anomalies: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  recommendedActions: Record<string, unknown>[];
  confidence: number | null;
}

export interface ReportDocument extends BaseDocument {
  executionId: DocumentId;
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  reportType: "donor" | "executive" | "activity" | "custom";
  title: string;
  summary: Record<string, unknown>;
  sections: Record<string, unknown>[];
  exports: Record<string, unknown>[];
  confidence: number | null;
}

export interface ChatSessionDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId | null;
  activityId: DocumentId | null;
  startedById: DocumentId;
  title: string | null;
  latestContext: Record<string, unknown> | null;
}

export interface ChatMessageDocument extends BaseDocument {
  chatSessionId: DocumentId;
  role: "system" | "user" | "assistant" | "tool";
  content: Record<string, unknown>;
  executionId: DocumentId | null;
}
