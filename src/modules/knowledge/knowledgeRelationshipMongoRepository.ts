import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  deleteAllByProjectId,
  deleteAllByField,
  toKnowledgeSourceInstanceDocument,
  toKnowledgeSourceInstanceRecord,
} from "./knowledgeRepositorySupport.js";
import {
  KnowledgeRelationshipMongoModel,
  type KnowledgeRelationshipMongoHydratedDocument,
} from "./knowledgeRelationshipModel.js";
import { ProjectKnowledgeModelMongoModel } from "./projectKnowledgeModelModel.js";
import type { KnowledgeRelationshipRepository } from "./knowledgeRelationshipRepository.js";
import type {
  KnowledgeRelationshipCreateInput,
  KnowledgeRelationshipPersistenceRecord,
} from "./knowledgeRelationshipPersistence.js";

function toRecord(
  document: KnowledgeRelationshipMongoHydratedDocument | null,
): KnowledgeRelationshipPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    projectKnowledgeModelId: document.projectKnowledgeModelId,
    fromEntityId: document.fromEntityId,
    toEntityId: document.toEntityId,
    relationshipType: document.relationshipType,
    confidence: document.confidence,
    sourceInstances: document.sourceInstances.map(
      toKnowledgeSourceInstanceRecord,
    ),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoKnowledgeRelationshipRepository implements KnowledgeRelationshipRepository {
  async create(
    input: KnowledgeRelationshipCreateInput,
    _session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord> {
    const document = await KnowledgeRelationshipMongoModel.create({
      _id: createDocumentId(),
      projectKnowledgeModelId: input.projectKnowledgeModelId,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      relationshipType: input.relationshipType,
      confidence: input.confidence,
      sourceInstances: input.sourceInstances.map(
        toKnowledgeSourceInstanceDocument,
      ),
    });
    return toRecord(document) as KnowledgeRelationshipPersistenceRecord;
  }

  async createMany(
    inputs: Array<KnowledgeRelationshipCreateInput & { id: string }>,
    _session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    await KnowledgeRelationshipMongoModel.bulkWrite(
      inputs.map((input) => ({
        insertOne: {
          document: {
            _id: input.id,
            projectKnowledgeModelId: input.projectKnowledgeModelId,
            fromEntityId: input.fromEntityId,
            toEntityId: input.toEntityId,
            relationshipType: input.relationshipType,
            confidence: input.confidence,
            sourceInstances: input.sourceInstances.map(
              toKnowledgeSourceInstanceDocument,
            ),
          },
        },
      })),
    );

    const documents = await KnowledgeRelationshipMongoModel.find({
      _id: { $in: inputs.map((input) => input.id) },
    }).exec();
    const byId = new Map(
      documents.map((document) => [document._id.toString(), document]),
    );

    return inputs
      .map((input) => toRecord(byId.get(input.id) ?? null))
      .filter((record): record is KnowledgeRelationshipPersistenceRecord =>
        Boolean(record),
      );
  }

  async listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    _session: DatabaseSession,
  ): Promise<KnowledgeRelationshipPersistenceRecord[]> {
    const documents = await KnowledgeRelationshipMongoModel.find({
      projectKnowledgeModelId,
    }).exec();
    return documents
      .map(toRecord)
      .filter((record): record is KnowledgeRelationshipPersistenceRecord =>
        Boolean(record),
      );
  }

  async deleteByEntityIds(
    entityIds: string[],
    _session: DatabaseSession,
  ): Promise<number> {
    if (entityIds.length === 0) {
      return 0;
    }

    const result = await KnowledgeRelationshipMongoModel.deleteMany({
      $or: [
        { fromEntityId: { $in: entityIds } },
        { toEntityId: { $in: entityIds } },
      ],
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    return deleteAllByField(
      KnowledgeRelationshipMongoModel,
      "projectKnowledgeModelId",
      projectKnowledgeModelId,
    );
  }

  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    return deleteAllByProjectId(
      KnowledgeRelationshipMongoModel,
      ProjectKnowledgeModelMongoModel,
      projectId,
    );
  }
}
