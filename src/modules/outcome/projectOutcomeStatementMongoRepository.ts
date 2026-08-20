import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  ProjectOutcomeStatementMongoModel,
  type ProjectOutcomeStatementMongoHydratedDocument,
} from "./projectOutcomeStatementModel.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type {
  ProjectOutcomeStatementCreateInput,
  ProjectOutcomeStatementPersistenceRecord,
  ProjectOutcomeStatementUpdateInput,
} from "./projectOutcomeStatementPersistence.js";

function toProjectOutcomeStatementRecord(
  document: ProjectOutcomeStatementMongoHydratedDocument | null,
): ProjectOutcomeStatementPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    projectId: document.projectId,
    organizationId: document.organizationId,
    term: document.term as ProjectOutcomeStatementPersistenceRecord["term"],
    statement: document.statement,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoProjectOutcomeStatementRepository implements ProjectOutcomeStatementRepository {
  async create(
    input: ProjectOutcomeStatementCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord> {
    const [document] = await ProjectOutcomeStatementMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toProjectOutcomeStatementRecord(
      document,
    ) as ProjectOutcomeStatementPersistenceRecord;
  }

  async findById(
    outcomeStatementId: string,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectOutcomeStatementMongoModel.findById(outcomeStatementId),
      session,
    ).exec();
    return toProjectOutcomeStatementRecord(document);
  }

  async listByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord[]> {
    const documents = await applyMongoSession(
      ProjectOutcomeStatementMongoModel.find({ projectId }).sort({
        createdAt: 1,
      }),
      session,
    ).exec();

    return documents
      .map((document) => toProjectOutcomeStatementRecord(document))
      .filter(
        (record): record is ProjectOutcomeStatementPersistenceRecord =>
          record !== null,
      );
  }

  async update(
    outcomeStatementId: string,
    input: ProjectOutcomeStatementUpdateInput,
    session: DatabaseSession,
  ): Promise<ProjectOutcomeStatementPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProjectOutcomeStatementMongoModel.findByIdAndUpdate(
        outcomeStatementId,
        { $set: input },
        { returnDocument: "after" },
      ),
      session,
    ).exec();
    return toProjectOutcomeStatementRecord(document);
  }

  async deleteById(
    outcomeStatementId: string,
    session: DatabaseSession,
  ): Promise<boolean> {
    const result = await applyMongoSession(
      ProjectOutcomeStatementMongoModel.deleteOne({
        _id: outcomeStatementId,
      }),
      session,
    ).exec();
    return result.deletedCount === 1;
  }
}
