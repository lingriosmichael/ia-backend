export const aiContextKindValues = [
  "dataset",
  "activity",
  "project",
  "organization",
  "report",
  "chat",
] as const;

export type AIContextKind = (typeof aiContextKindValues)[number];

export interface DatasetColumnContext {
  name: string;
  semanticType: string | null;
  sampleValues: string[];
}

export interface DatasetContext {
  kind: "dataset";
  uploadId: string;
  projectId: string;
  activityId: string | null;
  organizationId: string;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  columns: DatasetColumnContext[];
}

export interface ActivityContext {
  kind: "activity";
  activityId: string;
  projectId: string;
  name: string;
  description: string | null;
  objectives: string | null;
  expectedOutcomes: string | null;
}

export interface ProjectContext {
  kind: "project";
  projectId: string;
  organizationId: string;
  name: string;
  fundingProgram: string | null;
  fundingOrganization: string | null;
  areaOfOperation: string | null;
  partnerships: string | null;
  sdgs: string[];
  targetGroups: string[];
  impactModel: {
    inputs: string | null;
    activities: string | null;
    outputs: string | null;
    impact: string | null;
    outcomes: string | null;
  };
  successIndicators: string | null;
}

export interface OrganizationContext {
  kind: "organization";
  organizationId: string;
  name: string;
  mission: string | null;
}

export interface ReportContext {
  kind: "report";
  projectId: string;
  activityId: string | null;
  reportType: "donor" | "executive" | "activity" | "custom";
  title: string;
}

export interface ChatContext {
  kind: "chat";
  projectId: string | null;
  activityId: string | null;
  sessionTitle: string | null;
  latestUserMessage: string;
}

export type AIContextObject =
  | DatasetContext
  | ActivityContext
  | ProjectContext
  | OrganizationContext
  | ReportContext
  | ChatContext;
