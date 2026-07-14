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
  deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  /**
   * Cascade-deletes relationships that reference any of the given entity
   * ids on either side — used when a KnowledgeEntity is deleted (its
   * provenance was fully pruned) so no relationship is left dangling on
   * a now-nonexistent entity.
   */
  deleteByEntityIds(
    entityIds: string[],
    session: DatabaseSession,
  ): Promise<number>;
}
