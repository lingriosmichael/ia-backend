import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
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

    const [created] = await ProjectKnowledgeModelMongoModel.create(
      [
        {
          _id: createDocumentId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          version: 0,
          status: "building",
        },
      ],
      getMongoSessionOptions(session),
    );
    return toRecord(created) as ProjectKnowledgeModelPersistenceRecord;
  }

  async markBuilding(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "building" }, session);
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
