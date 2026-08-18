import type {
  InterpretationQuestionCode,
  InterpretationQuestionDomain,
  InterpretationQuestionKind,
  ActivityStatus,
  ActivitySystemType,
} from "../../shared/contracts.js";

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

export interface ActivityLlmTokenLedgerPersistence {
  totalPromptTokensLifetime: number;
  totalCompletionTokensLifetime: number;
  totalTokensLifetime: number;
}

export interface ActivityPersistenceRecord {
  id: string;
  projectId: string;
  systemType: ActivitySystemType | null;
  name: string;
  description: string | null;
  activityType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  targetAudience: string | null;
  objectives: string | null;
  output: string | null;
  concernTaggingInstruction: string | null;
  status: ActivityStatus;
  interpretationAcknowledgedAt: Date | null;
  interpretationAcknowledgedById: string | null;
  activityAnalysisV2ClarificationAnswers?: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[];
  llmTokenLedger?: ActivityLlmTokenLedgerPersistence;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityCreateInput {
  projectId: string;
  createdById: string;
  systemType?: ActivitySystemType | null;
  name: string;
  description: string | null;
  activityType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  targetAudience: string | null;
  objectives: string | null;
  output: string | null;
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
  concernTaggingInstruction?: string | null;
  status?: ActivityStatus;
  interpretationAcknowledgedAt?: Date | null;
  interpretationAcknowledgedById?: string | null;
  activityAnalysisV2ClarificationAnswers?: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[];
}

export interface SystemActivityEnsureInput {
  projectId: string;
  createdById: string;
  systemType: ActivitySystemType;
  name: string;
}

export interface ActivityLlmTokenLedgerIncrement {
  totalPromptTokensLifetime: number;
  totalCompletionTokensLifetime: number;
  totalTokensLifetime: number;
}
