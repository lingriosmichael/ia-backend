import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { isMongoDuplicateKeyError } from "../../shared/database/mongoErrors.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  ProjectKnowledgeModelMongoModel,
  type ProjectKnowledgeModelMongoHydratedDocument,
} from "./projectKnowledgeModelModel.js";
import type { ProjectKnowledgeModelRepository } from "./projectKnowledgeModelRepository.js";
import type {
  ProjectKnowledgeModelCreateInput,
  ProjectKnowledgeModelPersistenceRecord,
} from "./projectKnowledgeModelPersistence.js";

function toRecord(
  document: ProjectKnowledgeModelMongoHydratedDocument | null,
): ProjectKnowledgeModelPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    version: document.version,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectKnowledgeModelRepository implements ProjectKnowledgeModelRepository {
  private async updateStatus(
    projectId: string,
    fields: { status: "building" | "ready" | "stale"; version?: number },
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectKnowledgeModelMongoModel.findOneAndUpdate(
        { projectId },
        { $set: fields },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async findByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectKnowledgeModelMongoModel.findOne({
        projectId,
      }),
      session,
    ).exec();
    return toRecord(document);
  }

  async findOrCreateByProjectId(
    input: ProjectKnowledgeModelCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord> {
    const existing = await applyMongoSession(
      ProjectKnowledgeModelMongoModel.findOne({
        projectId: input.projectId,
      }),
      session,
    ).exec();
    if (existing) {
      return toRecord(existing) as ProjectKnowledgeModelPersistenceRecord;
    }

    // `projectId` has a unique index (exactly one model per project, ever).
    // Two concurrent first-time builds can both miss the findOne above and
    // both attempt to create — the loser's insert throws a duplicate-key
    // error rather than silently corrupting anything, so treat it as "the
    // other caller won the race" and read back what they created instead
    // of letting the raw Mongo error propagate as an unhandled 500.
    //
    // Created as "stale" (never built yet), not "building" — buildForProject
    // claims the actual build lock immediately afterward via markBuilding's
    // CAS update. Creating directly as "building" would make that CAS a
    // no-op for a brand new project (its own filter excludes "building"),
    // defeating the lock on every first-ever build.
    try {
      const [created] = await ProjectKnowledgeModelMongoModel.create(
        [
          {
            _id: createDocumentId(),
            organizationId: input.organizationId,
            projectId: input.projectId,
            version: 0,
            status: "stale",
          },
        ],
        getMongoSessionOptions(session),
      );
      return toRecord(created) as ProjectKnowledgeModelPersistenceRecord;
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      const winner = await applyMongoSession(
        ProjectKnowledgeModelMongoModel.findOne({
          projectId: input.projectId,
        }),
        session,
      ).exec();
      if (!winner) {
        throw error;
      }
      return toRecord(winner) as ProjectKnowledgeModelPersistenceRecord;
    }
  }

  /**
   * Atomically claims the build lock: only transitions to `"building"` if
   * the model isn't already `"building"`. Returns `null` if another build
   * is already in progress — the caller must treat that as "do not proceed
   * with this build," not as "the model doesn't exist" (findOrCreateByProjectId
   * is always called first, so the document is guaranteed to exist here).
   * This is what actually serializes concurrent buildForProject calls for
   * the same project; without it, two callers can both read a stale/null
   * status, both decide to rebuild, and both write duplicate entities from
   * their own stale in-memory snapshots.
   */
  async markBuilding(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectKnowledgeModelMongoModel.findOneAndUpdate(
        { projectId, status: { $ne: "building" } },
        { $set: { status: "building" } },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async markReady(
    projectId: string,
    version: number,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "ready", version }, session);
  }

  async markStale(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "stale" }, session);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ProjectKnowledgeModelMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
