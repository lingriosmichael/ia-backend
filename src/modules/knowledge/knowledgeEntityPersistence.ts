import type {
  KnowledgeEntityType,
  KnowledgeSourceInstance,
} from "../../shared/contracts.js";

export interface KnowledgeEntityPersistenceRecord {
  id: string;
  projectKnowledgeModelId: string;
  entityType: KnowledgeEntityType;
  canonicalLabel: string;
  description: string;
  attributes: Record<string, unknown>;
  sourceInstances: KnowledgeSourceInstance[];
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntityCreateInput {
  projectKnowledgeModelId: string;
  entityType: KnowledgeEntityType;
  canonicalLabel: string;
  description: string;
  attributes: Record<string, unknown>;
  sourceInstances: KnowledgeSourceInstance[];
}
