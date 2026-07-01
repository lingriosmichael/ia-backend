import type { ActivityStatus } from "../../shared/contracts.js";

export interface ActivityPersistenceRecord {
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
  status: ActivityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityCreateInput {
  projectId: string;
  createdById: string;
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
  status?: ActivityStatus;
}

export interface ActivityUpdateInput {
  name?: string;
  slug?: string;
  description?: string | null;
  activityType?: string | null;
  owner?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  objectives?: string | null;
  expectedOutcomes?: string | null;
  successIndicators?: string | null;
  targetAudience?: string | null;
  beneficiaryGroup?: string | null;
  status?: ActivityStatus;
}
