import type { DatabaseSession } from "../../shared/database/database-client.js";
import { createDocumentId } from "../../shared/database/document-id.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ProjectMongoModel,
  type ProjectMongoHydratedDocument,
} from "./project.model.js";
import type { ProjectRepository } from "./project.repository.js";
import type {
  ProjectCreateInput,
  ProjectPersistenceRecord,
  ProjectUpdateInput,
} from "./project.persistence.js";

function toProjectRecord(
  document: ProjectMongoHydratedDocument | null,
): ProjectPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    name: document.name,
    slug: document.slug,
    description: document.description ?? null,
    programGoal: document.programGoal ?? null,
    startMonth: document.startMonth ?? null,
    endMonth: document.endMonth ?? null,
    country: document.country ?? null,
    regionCity: document.regionCity ?? null,
    sdgs: document.sdgs,
    targetBeneficiaries: document.targetBeneficiaries,
    fundingSource: document.fundingSource ?? null,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectRepository implements ProjectRepository {
  async slugExists(
    organizationId: string,
    slug: string,
    _session: DatabaseSession,
  ): Promise<boolean> {
    const count = await ProjectMongoModel.countDocuments({ organizationId, slug }).exec();
    return count > 0;
  }

  async create(
    input: ProjectCreateInput,
    _session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord> {
    const document = await ProjectMongoModel.create({
      _id: createDocumentId(),
      ...input,
      status: input.status ?? "planning",
    });

    return toProjectRecord(document) as ProjectPersistenceRecord;
  }

  async findById(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord | null> {
    const document = await ProjectMongoModel.findById(projectId).exec();
    return toProjectRecord(document);
  }

  async findDeleteContext(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<{ id: string; name: string; organizationId: string } | null> {
    const document = await ProjectMongoModel.findById(projectId)
      .select({
        _id: 1,
        name: 1,
        organizationId: 1,
      })
      .exec();

    if (!document) {
      return null;
    }

    return {
      id: document._id.toString(),
      name: document.name,
      organizationId: document.organizationId,
    };
  }

  async update(
    projectId: string,
    input: ProjectUpdateInput,
    _session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord> {
    const document = await ProjectMongoModel.findByIdAndUpdate(
      projectId,
      {
        $set: input,
      },
      {
        new: true,
      },
    ).exec();

    const record = toProjectRecord(document);

    if (!record) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return record;
  }

  async listByOrganization(
    organizationId: string,
    _session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]> {
    const documents = await ProjectMongoModel.find({ organizationId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toProjectRecord(document))
      .filter((document): document is ProjectPersistenceRecord => Boolean(document));
  }

  async delete(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<{ id: string; organizationId: string }> {
    const document = await ProjectMongoModel.findByIdAndDelete(projectId)
      .select({
        _id: 1,
        organizationId: 1,
      })
      .exec();

    if (!document) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return {
      id: document._id.toString(),
      organizationId: document.organizationId,
    };
  }
}
