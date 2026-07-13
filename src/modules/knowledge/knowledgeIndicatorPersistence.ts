export interface KnowledgeIndicatorSourceEvidence {
  uploadMetadataId: string;
  interpretationResultId: string;
  sourceReference: string;
}

export interface KnowledgeIndicatorPersistenceRecord {
  id: string;
  projectKnowledgeModelId: string;
  knowledgeEntityId: string;
  value: number;
  unit: string | null;
  activityId: string;
  participantId: string | null;
  sourceEvidence: KnowledgeIndicatorSourceEvidence;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeIndicatorCreateInput {
  projectKnowledgeModelId: string;
  knowledgeEntityId: string;
  value: number;
  unit: string | null;
  activityId: string;
  participantId: string | null;
  sourceEvidence: KnowledgeIndicatorSourceEvidence;
  confidence: number;
}
