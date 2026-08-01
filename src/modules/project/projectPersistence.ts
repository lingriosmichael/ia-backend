import type { ProjectStatus } from "../../shared/contracts.js";

export interface ProjectImpactModelPersistence {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  impact: string | null;
  outcomes: string | null;
}

export interface ProjectLlmTokenLedgerPersistence {
  totalPromptTokensLifetime: number;
  totalCompletionTokensLifetime: number;
  totalTokensLifetime: number;
}

export interface ProjectPersistenceRecord {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  projectGoal: string | null;
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
  impactModel: ProjectImpactModelPersistence;
  successIndicators: string | null;
  llmTokenLedger?: ProjectLlmTokenLedgerPersistence;
  status: ProjectStatus;
  archivedFromStatus?: Exclude<ProjectStatus, "completed"> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  organizationId: string;
  ownerId: string;
  name: string;
  initialSituation: string | null;
  startMonth: string;
  endMonth: string;
  fundingProgram: string | null;
  fundingOrganization: string | null;
  targetGroups: string[];
  overarchingTargetGroup: string;
  intendedChanges: string[];
  areaOfOperation: string | null;
  partnerships: string | null;
  sdgs: string[];
  impactModel: ProjectImpactModelPersistence;
  successIndicators: string | null;
  status?: ProjectStatus;
  archivedFromStatus?: Exclude<ProjectStatus, "completed"> | null;
}

export interface ProjectUpdateInput {
  name?: string;
  initialSituation?: string | null;
  startMonth?: string | null;
  endMonth?: string | null;
  fundingProgram?: string | null;
  fundingOrganization?: string | null;
  targetGroups?: string[];
  overarchingTargetGroup?: string;
  intendedChanges?: string[];
  areaOfOperation?: string | null;
  partnerships?: string | null;
  sdgs?: string[];
  impactModel?: Partial<ProjectImpactModelPersistence>;
  successIndicators?: string | null;
  status?: ProjectStatus;
  archivedFromStatus?: Exclude<ProjectStatus, "completed"> | null;
}

export interface ProjectLlmTokenLedgerIncrement {
  totalPromptTokensLifetime: number;
  totalCompletionTokensLifetime: number;
  totalTokensLifetime: number;
}
