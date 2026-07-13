import type {
  KnowledgeRelationshipType,
  KnowledgeSourceInstance,
} from "../../shared/contracts.js";

export interface KnowledgeRelationshipPersistenceRecord {
  id: string;
  projectKnowledgeModelId: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: KnowledgeRelationshipType;
  confidence: number;
  sourceInstances: KnowledgeSourceInstance[];
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeRelationshipCreateInput {
  projectKnowledgeModelId: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: KnowledgeRelationshipType;
  confidence: number;
  sourceInstances: KnowledgeSourceInstance[];
}
