import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  KnowledgeIndicatorCreateInput,
  KnowledgeIndicatorPersistenceRecord,
} from "./knowledgeIndicatorPersistence.js";

export interface KnowledgeIndicatorRepository {
  create(
    input: KnowledgeIndicatorCreateInput,
    session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord>;
  createMany(
    inputs: KnowledgeIndicatorCreateInput[],
    session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord[]>;
  listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord[]>;
  deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
