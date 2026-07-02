import type { ProjectStatus } from "../../shared/contracts.js";

export interface ProjectPersistenceRecord {
  id: string;
  organizationId: string;
  ownerId: string;
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
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  organizationId: string;
  ownerId: string;
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
  status?: ProjectStatus;
}

export interface ProjectUpdateInput {
  name?: string;
  slug?: string;
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
