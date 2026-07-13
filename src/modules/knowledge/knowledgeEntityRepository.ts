import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { KnowledgeSourceInstance } from "../../shared/contracts.js";
import type {
  KnowledgeEntityCreateInput,
  KnowledgeEntityPersistenceRecord,
} from "./knowledgeEntityPersistence.js";

export interface KnowledgeEntityRepository {
  create(
    input: KnowledgeEntityCreateInput,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord>;
  createMany(
    inputs: Array<KnowledgeEntityCreateInput & { id: string }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]>;
  listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]>;
  /**
   * Appends a new source instance to an existing entity's provenance
   * list — this is what a Tier 1/Tier 2 merge does, as opposed to
   * create(), which starts a brand-new entity. Never removes or
   * overwrites prior source instances.
   */
  addSourceInstance(
    knowledgeEntityId: string,
    sourceInstance: KnowledgeSourceInstance,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null>;
  addSourceInstances(
    knowledgeEntityId: string,
    sourceInstances: KnowledgeSourceInstance[],
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null>;
  addSourceInstancesMany(
    updates: Array<{
      knowledgeEntityId: string;
      sourceInstances: KnowledgeSourceInstance[];
    }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]>;
  /**
   * Removes a single source instance (by upload + interpretation result)
   * from an entity's provenance list — the reversal mechanism for an
   * incorrect merge, without touching the underlying interpretation
   * data it was read from.
   */
  removeSourceInstance(
    knowledgeEntityId: string,
    uploadMetadataId: string,
    interpretationResultId: string,
    sourceReference: string,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null>;
  removeSourceInstances(
    knowledgeEntityId: string,
    staleSourceInstances: Array<{
      uploadMetadataId: string;
      interpretationResultId: string;
      sourceReference: string;
    }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null>;
  deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
