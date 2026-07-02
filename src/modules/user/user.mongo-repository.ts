import type { DatabaseSession } from "../../shared/database/database-client.js";
import { createDocumentId } from "../../shared/database/document-id.js";
import {
  UserMongoModel,
  type UserMongoHydratedDocument,
} from "./user.model.js";
import type { UserRepository } from "./user.repository.js";
import type {
  UserCreateInput,
  UserPersistenceRecord,
} from "./user.persistence.js";

function toUserRecord(
  document: UserMongoHydratedDocument | null,
): UserPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    email: document.email,
    fullName: document.fullName,
    passwordHash: document.passwordHash,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoUserRepository implements UserRepository {
  async findByEmail(
    email: string,
    _session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null> {
    const document = await UserMongoModel.findOne({ email }).exec();
    return toUserRecord(document);
  }

  async findById(
    id: string,
    _session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null> {
    const document = await UserMongoModel.findById(id).exec();
    return toUserRecord(document);
  }

  async findByIds(
    ids: string[],
    _session: DatabaseSession,
  ): Promise<UserPersistenceRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const documents = await UserMongoModel.find({
      _id: { $in: ids },
    }).exec();

    return documents
      .map((document) => toUserRecord(document))
      .filter((document): document is UserPersistenceRecord => Boolean(document));
  }

  async create(
    input: UserCreateInput,
    _session: DatabaseSession,
  ): Promise<UserPersistenceRecord> {
    const document = await UserMongoModel.create({
      _id: createDocumentId(),
      ...input,
    });
    return toUserRecord(document) as UserPersistenceRecord;
  }
}
