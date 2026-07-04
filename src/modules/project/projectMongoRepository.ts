import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  ProjectMongoModel,
  type ProjectMongoHydratedDocument,
} from "./projectModel.js";
import type { ProjectRepository } from "./projectRepository.js";
import type {
  ProjectCreateInput,
  ProjectPersistenceRecord,
  ProjectUpdateInput,
} from "./projectPersistence.js";

function toProjectRecord(
  document: ProjectMongoHydratedDocument | null,
): ProjectPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    ownerId: document.ownerId ?? document.createdById,
    name: document.name,
    projectGoal: document.projectGoal ?? null,
    startMonth: document.startMonth ?? null,
    endMonth: document.endMonth ?? null,
    fundingProgram: document.fundingProgram ?? null,
    fundingOrganization: document.fundingOrganization ?? null,
    targetGroups: document.targetGroups ?? [],
    areaOfOperation: document.areaOfOperation ?? null,
    partnerships: document.partnerships ?? null,
    sdgs: document.sdgs,
    impactModel: {
      inputs: document.impactModel?.inputs ?? null,
      activities: document.impactModel?.activities ?? null,
      outputs: document.impactModel?.outputs ?? null,
      impact: document.impactModel?.impact ?? null,
      outcomes: document.impactModel?.outcomes ?? null,
    },
    successIndicators: document.successIndicators ?? null,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectRepository implements ProjectRepository {
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
      .filter((document): document is ProjectPersistenceRecord =>
        Boolean(document),
      );
  }

  async listByOrganizationForOwner(
    organizationId: string,
    ownerId: string,
    _session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]> {
    const documents = await ProjectMongoModel.find({ organizationId, ownerId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toProjectRecord(document))
      .filter((document): document is ProjectPersistenceRecord =>
        Boolean(document),
      );
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
