import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  ProjectMongoModel,
  type ProjectMongoHydratedDocument,
} from "./projectModel.js";
import type { ProjectRepository } from "./projectRepository.js";
import type {
  ProjectCreateInput,
  ProjectLlmTokenLedgerIncrement,
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
    ownerId: document.ownerId,
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
    llmTokenLedger: {
      totalPromptTokensLifetime:
        document.llmTokenLedger?.totalPromptTokensLifetime ?? 0,
      totalCompletionTokensLifetime:
        document.llmTokenLedger?.totalCompletionTokensLifetime ?? 0,
      totalTokensLifetime: document.llmTokenLedger?.totalTokensLifetime ?? 0,
    },
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectRepository implements ProjectRepository {
  async create(
    input: ProjectCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord> {
    const [document] = await ProjectMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
          status: input.status ?? "planning",
        },
      ],
      getMongoSessionOptions(session),
    );

    return toProjectRecord(document) as ProjectPersistenceRecord;
  }

  async findById(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectMongoModel.findById(projectId),
      session,
    ).exec();
    return toProjectRecord(document);
  }

  async findDeleteContext(
    projectId: string,
    session: DatabaseSession,
  ): Promise<{ id: string; name: string; organizationId: string } | null> {
    const document = await applyMongoSession(
      ProjectMongoModel.findById(projectId).select({
        _id: 1,
        name: 1,
        organizationId: 1,
      }),
      session,
    ).exec();

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
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord> {
    const document = await applyMongoSession(
      ProjectMongoModel.findByIdAndUpdate(
        projectId,
        {
          $set: input,
        },
        {
          returnDocument: "after",
        },
      ),
      session,
    ).exec();

    const record = toProjectRecord(document);

    if (!record) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return record;
  }

  async incrementLlmTokenLedger(
    projectId: string,
    increment: ProjectLlmTokenLedgerIncrement,
    session: DatabaseSession,
  ): Promise<void> {
    const document = await applyMongoSession(
      ProjectMongoModel.findByIdAndUpdate(
        projectId,
        {
          $inc: {
            "llmTokenLedger.totalPromptTokensLifetime":
              increment.totalPromptTokensLifetime,
            "llmTokenLedger.totalCompletionTokensLifetime":
              increment.totalCompletionTokensLifetime,
            "llmTokenLedger.totalTokensLifetime": increment.totalTokensLifetime,
          },
        },
        {
          returnDocument: "after",
        },
      ).select({ _id: 1 }),
      session,
    ).exec();

    if (!document) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }
  }

  async transferOwnership(
    projectId: string,
    newOwnerId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord> {
    const document = await applyMongoSession(
      ProjectMongoModel.findByIdAndUpdate(
        projectId,
        {
          $set: { ownerId: newOwnerId },
        },
        {
          returnDocument: "after",
        },
      ),
      session,
    ).exec();

    const record = toProjectRecord(document);

    if (!record) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return record;
  }

  async listByOrganization(
    organizationId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]> {
    const documents = await applyMongoSession(
      ProjectMongoModel.find({ organizationId }).sort({ createdAt: -1 }),
      session,
    ).exec();

    return documents
      .map((document) => toProjectRecord(document))
      .filter((document): document is ProjectPersistenceRecord =>
        Boolean(document),
      );
  }

  async listByOrganizationForOwner(
    organizationId: string,
    ownerId: string,
    session: DatabaseSession,
  ): Promise<ProjectPersistenceRecord[]> {
    const documents = await applyMongoSession(
      ProjectMongoModel.find({ organizationId, ownerId }).sort({
        createdAt: -1,
      }),
      session,
    ).exec();

    return documents
      .map((document) => toProjectRecord(document))
      .filter((document): document is ProjectPersistenceRecord =>
        Boolean(document),
      );
  }

  async delete(
    projectId: string,
    session: DatabaseSession,
  ): Promise<{ id: string; organizationId: string }> {
    const document = await applyMongoSession(
      ProjectMongoModel.findByIdAndDelete(projectId).select({
        _id: 1,
        organizationId: 1,
      }),
      session,
    ).exec();

    if (!document) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return {
      id: document._id.toString(),
      organizationId: document.organizationId,
    };
  }
}
