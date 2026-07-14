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
  /**
   * Deletes entities outright — used when pruning leaves an entity with
   * zero source instances (its only evidence was deleted, an activity
   * was removed, or a previously-kept indicator was rejected). An entity
   * with no provenance must not be left behind: besides violating the
   * "every entity traces to real evidence" guarantee, hasCompatibleActivity
   * in projectKnowledgeBuilderService treats an entity with zero source
   * instances as a wildcard match for any future activity, which would
   * silently reintroduce a false-merge risk.
   */
  deleteMany(ids: string[], session: DatabaseSession): Promise<number>;
}
