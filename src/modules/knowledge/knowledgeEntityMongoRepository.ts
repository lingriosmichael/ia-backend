import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import type { KnowledgeSourceInstance } from "../../shared/contracts.js";
import {
  deleteAllByProjectId,
  deleteAllByField,
  toKnowledgeSourceInstanceDocument,
  toKnowledgeSourceInstanceRecord,
} from "./knowledgeRepositorySupport.js";
import {
  KnowledgeEntityMongoModel,
  type KnowledgeEntityMongoHydratedDocument,
} from "./knowledgeEntityModel.js";
import { ProjectKnowledgeModelMongoModel } from "./projectKnowledgeModelModel.js";
import type { KnowledgeEntityRepository } from "./knowledgeEntityRepository.js";
import type {
  KnowledgeEntityCreateInput,
  KnowledgeEntityPersistenceRecord,
} from "./knowledgeEntityPersistence.js";

function toRecord(
  document: KnowledgeEntityMongoHydratedDocument | null,
): KnowledgeEntityPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    projectKnowledgeModelId: document.projectKnowledgeModelId,
    entityType: document.entityType,
    canonicalLabel: document.canonicalLabel,
    description: document.description ?? "",
    attributes: (document.attributes as Record<string, unknown>) ?? {},
    sourceInstances: document.sourceInstances.map(
      toKnowledgeSourceInstanceRecord,
    ),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoKnowledgeEntityRepository implements KnowledgeEntityRepository {
  async create(
    input: KnowledgeEntityCreateInput,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord> {
    const [document] = await KnowledgeEntityMongoModel.create(
      [
        {
          _id: createDocumentId(),
          projectKnowledgeModelId: input.projectKnowledgeModelId,
          entityType: input.entityType,
          canonicalLabel: input.canonicalLabel,
          description: input.description,
          attributes: input.attributes,
          sourceInstances: input.sourceInstances.map(
            toKnowledgeSourceInstanceDocument,
          ),
        },
      ],
      getMongoSessionOptions(session),
    );
    return toRecord(document) as KnowledgeEntityPersistenceRecord;
  }

  async createMany(
    inputs: Array<KnowledgeEntityCreateInput & { id: string }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    await KnowledgeEntityMongoModel.bulkWrite(
      inputs.map((input) => ({
        insertOne: {
          document: {
            _id: input.id,
            projectKnowledgeModelId: input.projectKnowledgeModelId,
            entityType: input.entityType,
            canonicalLabel: input.canonicalLabel,
            description: input.description,
            attributes: input.attributes,
            sourceInstances: input.sourceInstances.map(
              toKnowledgeSourceInstanceDocument,
            ),
          },
        },
      })),
      getMongoSessionOptions(session),
    );

    const documents = await applyMongoSession(
      KnowledgeEntityMongoModel.find({
        _id: { $in: inputs.map((input) => input.id) },
      }),
      session,
    ).exec();
    const byId = new Map(
      documents.map((document) => [document._id.toString(), document]),
    );

    return inputs
      .map((input) => toRecord(byId.get(input.id) ?? null))
      .filter((record): record is KnowledgeEntityPersistenceRecord =>
        Boolean(record),
      );
  }

  async listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]> {
    const documents = await applyMongoSession(
      KnowledgeEntityMongoModel.find({
        projectKnowledgeModelId,
      }),
      session,
    ).exec();
    return documents
      .map(toRecord)
      .filter((record): record is KnowledgeEntityPersistenceRecord =>
        Boolean(record),
      );
  }

  async addSourceInstance(
    knowledgeEntityId: string,
    sourceInstance: KnowledgeSourceInstance,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null> {
    const document = await applyMongoSession(
      KnowledgeEntityMongoModel.findByIdAndUpdate(
        knowledgeEntityId,
        {
          $push: {
            sourceInstances: toKnowledgeSourceInstanceDocument(sourceInstance),
          },
        },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async addSourceInstances(
    knowledgeEntityId: string,
    sourceInstances: KnowledgeSourceInstance[],
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null> {
    if (sourceInstances.length === 0) {
      const existing = await applyMongoSession(
        KnowledgeEntityMongoModel.findById(knowledgeEntityId),
        session,
      ).exec();
      return toRecord(existing);
    }

    const document = await applyMongoSession(
      KnowledgeEntityMongoModel.findByIdAndUpdate(
        knowledgeEntityId,
        {
          $push: {
            sourceInstances: {
              $each: sourceInstances.map(toKnowledgeSourceInstanceDocument),
            },
          },
        },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async addSourceInstancesMany(
    updates: Array<{
      knowledgeEntityId: string;
      sourceInstances: KnowledgeSourceInstance[];
    }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord[]> {
    const nonEmptyUpdates = updates.filter(
      (update) => update.sourceInstances.length > 0,
    );
    if (nonEmptyUpdates.length === 0) {
      return [];
    }

    const operations = nonEmptyUpdates.map((update) => ({
      updateOne: {
        filter: { _id: update.knowledgeEntityId },
        update: {
          $push: {
            sourceInstances: {
              $each: update.sourceInstances.map(
                toKnowledgeSourceInstanceDocument,
              ),
            },
          },
        },
      },
    }));

    await KnowledgeEntityMongoModel.bulkWrite(
      operations as never,
      getMongoSessionOptions(session),
    );

    const ids = nonEmptyUpdates.map((update) => update.knowledgeEntityId);
    const documents = await applyMongoSession(
      KnowledgeEntityMongoModel.find({
        _id: { $in: ids },
      }),
      session,
    ).exec();
    const byId = new Map(
      documents.map((document) => [document._id.toString(), document]),
    );

    return ids
      .map((id) => toRecord(byId.get(id) ?? null))
      .filter((record): record is KnowledgeEntityPersistenceRecord =>
        Boolean(record),
      );
  }

  async removeSourceInstance(
    knowledgeEntityId: string,
    uploadMetadataId: string,
    interpretationResultId: string,
    sourceReference: string,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null> {
    const document = await applyMongoSession(
      KnowledgeEntityMongoModel.findByIdAndUpdate(
        knowledgeEntityId,
        {
          $pull: {
            sourceInstances: {
              uploadMetadataId,
              interpretationResultId,
              sourceReference,
            },
          },
        },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async removeSourceInstances(
    knowledgeEntityId: string,
    staleSourceInstances: Array<{
      uploadMetadataId: string;
      interpretationResultId: string;
      sourceReference: string;
    }>,
    session: DatabaseSession,
  ): Promise<KnowledgeEntityPersistenceRecord | null> {
    if (staleSourceInstances.length === 0) {
      const existing = await applyMongoSession(
        KnowledgeEntityMongoModel.findById(knowledgeEntityId),
        session,
      ).exec();
      return toRecord(existing);
    }

    const document = await applyMongoSession(
      KnowledgeEntityMongoModel.findByIdAndUpdate(
        knowledgeEntityId,
        {
          $pull: {
            sourceInstances: {
              $or: staleSourceInstances.map((instance) => ({
                uploadMetadataId: instance.uploadMetadataId,
                interpretationResultId: instance.interpretationResultId,
                sourceReference: instance.sourceReference,
              })),
            },
          },
        },
        { new: true },
      ),
      session,
    ).exec();
    return toRecord(document);
  }

  async deleteMany(ids: string[], session: DatabaseSession): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const result = await applyMongoSession(
      KnowledgeEntityMongoModel.deleteMany({
        _id: { $in: ids },
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number> {
    return deleteAllByField(
      KnowledgeEntityMongoModel,
      "projectKnowledgeModelId",
      projectKnowledgeModelId,
      session,
    );
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    return deleteAllByProjectId(
      KnowledgeEntityMongoModel,
      ProjectKnowledgeModelMongoModel,
      projectId,
      session,
    );
  }
}
