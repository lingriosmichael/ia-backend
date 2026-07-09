import type { ActivityStatus } from "../../shared/contracts.js";

export interface ActivityPersistenceRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  activityType: string | null;
  owner: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  additionalContext: string | null;
  status: ActivityStatus;
  interpretationAcknowledgedAt: Date | null;
  interpretationAcknowledgedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityCreateInput {
  projectId: string;
  createdById: string;
  name: string;
  description: string | null;
  activityType: string | null;
  owner: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  successIndicators: string | null;
  targetAudience: string | null;
  additionalContext: string | null;
  status?: ActivityStatus;
}

export interface ActivityUpdateInput {
  name?: string;
  description?: string | null;
  activityType?: string | null;
  owner?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  objectives?: string | null;
  successIndicators?: string | null;
  targetAudience?: string | null;
  additionalContext?: string | null;
  status?: ActivityStatus;
  interpretationAcknowledgedAt?: Date | null;
  interpretationAcknowledgedById?: string | null;
}
