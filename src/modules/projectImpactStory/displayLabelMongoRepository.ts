import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import {
  DisplayLabelMongoModel,
  type DisplayLabelMongoHydratedDocument,
} from "./displayLabelModel.js";
import type { DisplayLabelRepository } from "./displayLabelRepository.js";
import type {
  DisplayLabelCreateInput,
  DisplayLabelLanguage,
  DisplayLabelPersistenceRecord,
} from "./displayLabelPersistence.js";

function toDisplayLabelRecord(
  document: DisplayLabelMongoHydratedDocument,
): DisplayLabelPersistenceRecord {
  return {
    key: document._id,
    sourceText: document.sourceText,
    language: document.language as DisplayLabelLanguage,
    displayLabel: document.displayLabel,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoDisplayLabelRepository implements DisplayLabelRepository {
  async findByKeys(
    keys: string[],
    session: DatabaseSession,
  ): Promise<DisplayLabelPersistenceRecord[]> {
    if (keys.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      DisplayLabelMongoModel.find({ _id: { $in: keys } }),
      session,
    ).exec();

    return documents.map((document) => toDisplayLabelRecord(document));
  }

  async create(
    input: DisplayLabelCreateInput,
    session: DatabaseSession,
  ): Promise<DisplayLabelPersistenceRecord> {
    const [document] = await DisplayLabelMongoModel.create(
      [
        {
          _id: input.key,
          sourceText: input.sourceText,
          language: input.language,
          displayLabel: input.displayLabel,
        },
      ],
      getMongoSessionOptions(session),
    );

    return toDisplayLabelRecord(document as DisplayLabelMongoHydratedDocument);
  }
}
