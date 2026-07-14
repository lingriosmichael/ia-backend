import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  KnowledgeIndicatorMongoModel,
  type KnowledgeIndicatorMongoHydratedDocument,
} from "./knowledgeIndicatorModel.js";
import type { KnowledgeIndicatorRepository } from "./knowledgeIndicatorRepository.js";
import type {
  KnowledgeIndicatorCreateInput,
  KnowledgeIndicatorPersistenceRecord,
} from "./knowledgeIndicatorPersistence.js";

function toRecord(
  document: KnowledgeIndicatorMongoHydratedDocument | null,
): KnowledgeIndicatorPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    projectKnowledgeModelId: document.projectKnowledgeModelId,
    knowledgeEntityId: document.knowledgeEntityId,
    value: document.value,
    unit: document.unit ?? null,
    activityId: document.activityId,
    participantId: document.participantId ?? null,
    sourceEvidence: {
      uploadMetadataId: document.sourceEvidence.uploadMetadataId,
      interpretationResultId: document.sourceEvidence.interpretationResultId,
      sourceReference: document.sourceEvidence.sourceReference,
    },
    confidence: document.confidence,
    deduplicationConfidence: document.deduplicationConfidence,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoKnowledgeIndicatorRepository implements KnowledgeIndicatorRepository {
  async create(
    input: KnowledgeIndicatorCreateInput,
    _session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord> {
    const document = await KnowledgeIndicatorMongoModel.create({
      _id: createDocumentId(),
      projectKnowledgeModelId: input.projectKnowledgeModelId,
      knowledgeEntityId: input.knowledgeEntityId,
      value: input.value,
      unit: input.unit,
      activityId: input.activityId,
      participantId: input.participantId,
      sourceEvidence: input.sourceEvidence,
      confidence: input.confidence,
      deduplicationConfidence: input.deduplicationConfidence,
    });
    return toRecord(document) as KnowledgeIndicatorPersistenceRecord;
  }

  async createMany(
    inputs: KnowledgeIndicatorCreateInput[],
    _session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    const documents = await KnowledgeIndicatorMongoModel.insertMany(
      inputs.map((input) => ({
        _id: createDocumentId(),
        projectKnowledgeModelId: input.projectKnowledgeModelId,
        knowledgeEntityId: input.knowledgeEntityId,
        value: input.value,
        unit: input.unit,
        activityId: input.activityId,
        participantId: input.participantId,
        sourceEvidence: input.sourceEvidence,
        confidence: input.confidence,
        deduplicationConfidence: input.deduplicationConfidence,
      })),
    );
    return documents
      .map((document) =>
        toRecord(document as unknown as KnowledgeIndicatorMongoHydratedDocument),
      )
      .filter((record): record is KnowledgeIndicatorPersistenceRecord =>
        Boolean(record),
      );
  }

  async listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    _session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord[]> {
    const documents = await KnowledgeIndicatorMongoModel.find({
      projectKnowledgeModelId,
    }).exec();
    return documents
      .map(toRecord)
      .filter((record): record is KnowledgeIndicatorPersistenceRecord =>
        Boolean(record),
      );
  }

  async deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await KnowledgeIndicatorMongoModel.deleteMany({
      projectKnowledgeModelId,
    }).exec();
    return result.deletedCount ?? 0;
  }
}
