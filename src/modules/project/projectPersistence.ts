import type { ProjectStatus } from "../../shared/contracts.js";

export interface ProjectImpactModelPersistence {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  impact: string | null;
  outcomes: string | null;
}

export interface ProjectPersistenceRecord {
  id: string;
  organizationId: string;
  ownerId: string;
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
  impactModel: ProjectImpactModelPersistence;
  successIndicators: string | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  organizationId: string;
  ownerId: string;
  name: string;
  startMonth: string;
  endMonth: string;
  fundingProgram: string;
  fundingOrganization: string;
  targetGroups: string[];
  areaOfOperation: string;
  partnerships: string | null;
  sdgs: string[];
  impactModel: {
    inputs: string;
    activities: string;
    outputs: string;
    impact: string;
    outcomes: string;
  };
  successIndicators: string;
  status?: ProjectStatus;
}

export interface ProjectUpdateInput {
  name?: string;
  startMonth?: string | null;
  endMonth?: string | null;
  fundingProgram?: string | null;
  fundingOrganization?: string | null;
  targetGroups?: string[];
  areaOfOperation?: string | null;
  partnerships?: string | null;
  sdgs?: string[];
  impactModel?: Partial<ProjectImpactModelPersistence>;
  successIndicators?: string | null;
  status?: ProjectStatus;
}
