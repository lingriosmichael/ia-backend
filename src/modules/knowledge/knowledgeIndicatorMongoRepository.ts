import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { deleteAllByProjectId } from "./knowledgeRepositorySupport.js";
import {
  KnowledgeIndicatorMongoModel,
  type KnowledgeIndicatorMongoHydratedDocument,
} from "./knowledgeIndicatorModel.js";
import { ProjectKnowledgeModelMongoModel } from "./projectKnowledgeModelModel.js";
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
    session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord> {
    const [document] = await KnowledgeIndicatorMongoModel.create(
      [
        {
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
        },
      ],
      getMongoSessionOptions(session),
    );
    return toRecord(document) as KnowledgeIndicatorPersistenceRecord;
  }

  async createMany(
    inputs: KnowledgeIndicatorCreateInput[],
    session: DatabaseSession,
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
      getMongoSessionOptions(session),
    );
    return documents
      .map((document) =>
        toRecord(
          document as unknown as KnowledgeIndicatorMongoHydratedDocument,
        ),
      )
      .filter((record): record is KnowledgeIndicatorPersistenceRecord =>
        Boolean(record),
      );
  }

  async listByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<KnowledgeIndicatorPersistenceRecord[]> {
    const documents = await applyMongoSession(
      KnowledgeIndicatorMongoModel.find({
        projectKnowledgeModelId,
      }),
      session,
    ).exec();
    return documents
      .map(toRecord)
      .filter((record): record is KnowledgeIndicatorPersistenceRecord =>
        Boolean(record),
      );
  }

  async deleteByProjectKnowledgeModelId(
    projectKnowledgeModelId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      KnowledgeIndicatorMongoModel.deleteMany({
        projectKnowledgeModelId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    return deleteAllByProjectId(
      KnowledgeIndicatorMongoModel,
      ProjectKnowledgeModelMongoModel,
      projectId,
      session,
    );
  }
}
