import type { ProjectKnowledgeModelStatus } from "../../shared/contracts.js";

export interface ProjectKnowledgeModelPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  version: number;
  status: ProjectKnowledgeModelStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectKnowledgeModelCreateInput {
  organizationId: string;
  projectId: string;
}
