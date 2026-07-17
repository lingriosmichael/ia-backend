import type {
  ActivityAiKnowledgeInsightSourceType,
  ActivityStatus,
} from "../../shared/contracts.js";

export interface ActivityAiKnowledgeInsightPersistenceRecord {
  id: string;
  sourceType: ActivityAiKnowledgeInsightSourceType;
  text: string;
  isGoalRelevant: boolean;
  sourceUploadMetadataIds: string[];
}

export interface ActivityAiKnowledgeSnapshotPersistenceRecord {
  generatedAt: Date;
  summaryText: string;
  interpretedEvidenceCount: number;
  totalEvidenceCount: number;
  insights: ActivityAiKnowledgeInsightPersistenceRecord[];
}

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
  aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
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
  aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
}
