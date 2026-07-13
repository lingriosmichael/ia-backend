import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
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
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    const document = await ProjectKnowledgeModelMongoModel.findOneAndUpdate(
      { projectId },
      { $set: fields },
      { new: true },
    ).exec();
    return toRecord(document);
  }

  async findByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    const document = await ProjectKnowledgeModelMongoModel.findOne({
      projectId,
    }).exec();
    return toRecord(document);
  }

  async findOrCreateByProjectId(
    input: ProjectKnowledgeModelCreateInput,
    _session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord> {
    const existing = await ProjectKnowledgeModelMongoModel.findOne({
      projectId: input.projectId,
    }).exec();
    if (existing) {
      return toRecord(existing) as ProjectKnowledgeModelPersistenceRecord;
    }

    const created = await ProjectKnowledgeModelMongoModel.create({
      _id: createDocumentId(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      version: 0,
      status: "building",
    });
    return toRecord(created) as ProjectKnowledgeModelPersistenceRecord;
  }

  async markBuilding(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "building" });
  }

  async markReady(
    projectId: string,
    version: number,
    _session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "ready", version });
  }

  async markStale(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<ProjectKnowledgeModelPersistenceRecord | null> {
    return this.updateStatus(projectId, { status: "stale" });
  }

  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await ProjectKnowledgeModelMongoModel.deleteMany({
      projectId,
    }).exec();
    return result.deletedCount ?? 0;
  }
}
