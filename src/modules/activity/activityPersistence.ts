import type {
  ActivityAiKnowledgeInsightSourceType,
  InterpretationQuestionCode,
  InterpretationQuestionDomain,
  InterpretationQuestionKind,
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

export interface ActivityAnalysisV2ClarificationAnswerPersistenceRecord {
  questionId: string;
  goalId: string | null;
  prompt: string;
  kind: InterpretationQuestionKind;
  questionDomain: InterpretationQuestionDomain;
  options: string[] | null;
  recommendedOption: string | null;
  recommendedConfidence: number | null;
  isBlocking: boolean;
  questionCode: InterpretationQuestionCode | null;
  targetTableName: string | null;
  targetColumnName: string | null;
  answeredValue: string;
  answeredById: string;
  answeredAt: Date;
}

export interface ActivityPersistenceRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  activityType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  targetAudience: string | null;
  objectives: string | null;
  output: string | null;
  outcome: string | null;
  concernTaggingInstruction: string | null;
  status: ActivityStatus;
  interpretationAcknowledgedAt: Date | null;
  interpretationAcknowledgedById: string | null;
  aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
  activityAnalysisV2ClarificationAnswers?: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityCreateInput {
  projectId: string;
  createdById: string;
  name: string;
  description: string | null;
  activityType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  targetAudience: string | null;
  objectives: string | null;
  output: string | null;
  outcome: string | null;
  concernTaggingInstruction: string | null;
  status?: ActivityStatus;
}

export interface ActivityUpdateInput {
  name?: string;
  description?: string | null;
  activityType?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  targetAudience?: string | null;
  objectives?: string | null;
  output?: string | null;
  outcome?: string | null;
  concernTaggingInstruction?: string | null;
  status?: ActivityStatus;
  interpretationAcknowledgedAt?: Date | null;
  interpretationAcknowledgedById?: string | null;
  aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
  activityAnalysisV2ClarificationAnswers?: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[];
}
