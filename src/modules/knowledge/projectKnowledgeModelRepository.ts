import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectKnowledgeModelCreateInput,
  ProjectKnowledgeModelPersistenceRecord,
} from "./projectKnowledgeModelPersistence.js";

export interface ProjectKnowledgeModelRepository {
  findByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null>;
  /**
   * Creates the project's knowledge model record if none exists yet, or
   * returns the existing one unchanged — there is exactly one
   * ProjectKnowledgeModel per project, ever.
   */
  findOrCreateByProjectId(
    input: ProjectKnowledgeModelCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord>;
  /**
   * Atomically claims the build lock: only transitions to `"building"` if
   * the model isn't already `"building"`. Returns `null` if another build
   * is already in progress — callers must not proceed with the build in
   * that case. Does not touch version — the version only advances once a
   * build actually completes (markReady).
   */
  markBuilding(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null>;
  /**
   * Marks a completed build ready and sets version to the given value —
   * the caller (ProjectKnowledgeBuilderService) decides the new version
   * number so it can keep it in lockstep with the entities/relationships/
   * indicators it just persisted for that same build.
   */
  markReady(
    projectId: string,
    version: number,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null>;
  markStale(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
