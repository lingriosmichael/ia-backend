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

export interface OrganizationDocument extends BaseDocument {
  name: string;
  slug: string;
  description: string | null;
  logoPath: string | null;
}

export interface MembershipDocument extends BaseDocument {
  userId: DocumentId;
  organizationId: DocumentId;
  role: "owner" | "member";
}

export interface ProjectDocument extends BaseDocument {
  organizationId: DocumentId;
  createdById: DocumentId;
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
  status: "planning" | "active" | "completed";
}

export interface ActivityDocument extends BaseDocument {
  projectId: DocumentId;
  createdById: DocumentId;
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
  status: "planning" | "active" | "completed";
}

export interface UploadDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadedById: DocumentId;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  status: "pending" | "uploaded" | "archived";
}

export interface AIExecutionDocument extends BaseDocument {
  organizationId: DocumentId;
  projectId: DocumentId;
  activityId: DocumentId | null;
  uploadId: DocumentId | null;
  triggeredById: DocumentId;
  pipeline:
    | "interpret_dataset"
    | "review_dataset"
    | "generate_metrics"
    | "generate_dashboard"
    | "generate_insights"
    | "generate_report"
    | "chat";
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  providerKey: string | null;
  promptVersion: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
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
