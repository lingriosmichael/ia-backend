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

/**
 * Intentionally unwired scaffolding for Phase 5 deterministic analytics.
 *
 * The current ProjectKnowledgeBuilderService (Phase 4) does not create
 * KnowledgeIndicator records yet because interpretation output currently
 * carries indicator concepts without a durable numeric value contract.
 *
 * Keep this repository in sync with the documented "Data Model — As Built"
 * in `Phase 4 — Project Knowledge Model.md`; wire it into runtime flows only
 * once Phase 5 lands numeric indicator extraction/persistence.
 */

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
    });
    return toRecord(document) as KnowledgeIndicatorPersistenceRecord;
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
