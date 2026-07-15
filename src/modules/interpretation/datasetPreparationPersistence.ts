import type {
  DatasetPreparationDecisionSummary,
  PreparedDatasetSnapshot,
  DatasetPreparationStatus,
  InterpretationQuestionCode,
} from "../../shared/contracts.js";

export interface DatasetPreparationDecisionPersistence {
  questionId: string;
  questionCode: InterpretationQuestionCode;
  questionPrompt: string;
  tableName: string | null;
  columnName: string | null;
  answeredValue: string;
  answeredById: string | null;
  answeredAt: Date | null;
}

export interface DatasetPreparationPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  status: DatasetPreparationStatus;
  blockingQuestionCount: number;
  answeredBlockingQuestionCount: number;
  unansweredBlockingQuestionIds: string[];
  decisions: DatasetPreparationDecisionPersistence[];
  decisionSummary: DatasetPreparationDecisionSummary;
  preparedDataset: PreparedDatasetSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetPreparationUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string | null;
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  interpretationResultId: string;
  status: DatasetPreparationStatus;
  blockingQuestionCount: number;
  answeredBlockingQuestionCount: number;
  unansweredBlockingQuestionIds: string[];
  decisions: DatasetPreparationDecisionPersistence[];
  decisionSummary: DatasetPreparationDecisionSummary;
  preparedDataset: PreparedDatasetSnapshot | null;
}
