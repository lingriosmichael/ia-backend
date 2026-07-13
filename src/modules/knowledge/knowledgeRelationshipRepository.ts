import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  KnowledgeRelationshipCreateInput,
  KnowledgeRelationshipPersistenceRecord,
} from "./knowledgeRelationshipPersistence.js";

export interface KnowledgeRelationshipRepository {
  create(
    input: KnowledgeRelationshipCreateInput,
    session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord>;
  createMany(
    inputs: Array<KnowledgeRelationshipCreateInput & { id: string }>,
    session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord[]>;
  listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord[]>;
  /**
   * Finds an existing relationship between the same two entities of the
   * same type, if one already exists — used to avoid creating a
   * duplicate KnowledgeRelationship every time the same underlying link
   * (e.g. the same qualitative finding's relationToEvidence) is seen
   * again across builds.
   */
  findByEntitiesAndType(
    projectKnowledgeModelId: string,
    fromEntityId: string,
    toEntityId: string,
    relationshipType: string,
    session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord | null>;
  deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
