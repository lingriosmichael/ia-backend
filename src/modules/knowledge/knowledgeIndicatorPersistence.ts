import type { KnowledgeIndicatorDeduplicationConfidence } from "../../shared/contracts.js";

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
  // Representative pointer to one contributing source, kept for a quick
  // reference — full provenance across every contributing source is on
  // the parent KnowledgeEntity.sourceInstances, not duplicated here.
  sourceEvidence: KnowledgeIndicatorSourceEvidence;
  confidence: number;
  deduplicationConfidence: KnowledgeIndicatorDeduplicationConfidence;
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
  deduplicationConfidence: KnowledgeIndicatorDeduplicationConfidence;
}
