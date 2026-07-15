import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
import { UserMongoModel, type UserMongoHydratedDocument } from "./userModel.js";
import type { UserRepository } from "./userRepository.js";
import type {
  UserCreateInput,
  UserPersistenceRecord,
} from "./userPersistence.js";

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
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null> {
    const document = await applyMongoSession(
      UserMongoModel.findOne({ email }),
      session,
    ).exec();
    return toUserRecord(document);
  }

  async findById(
    id: string,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null> {
    const document = await applyMongoSession(
      UserMongoModel.findById(id),
      session,
    ).exec();
    return toUserRecord(document);
  }

  async findByIds(
    ids: string[],
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      UserMongoModel.find({
        _id: { $in: ids },
      }),
      session,
    ).exec();

    return documents
      .map((document) => toUserRecord(document))
      .filter((document): document is UserPersistenceRecord =>
        Boolean(document),
      );
  }

  async create(
    input: UserCreateInput,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord> {
    const [document] = await UserMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
        },
      ],
      getMongoSessionOptions(session),
    );
    return toUserRecord(document) as UserPersistenceRecord;
  }
}
