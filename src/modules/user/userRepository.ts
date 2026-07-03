import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  UserCreateInput,
  UserPersistenceRecord,
} from "./userPersistence.js";

export interface UserRepository {
  findByEmail(
    email: string,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null>;
  findById(
    id: string,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null>;
  findByIds(
    ids: string[],
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord[]>;
  create(
    input: UserCreateInput,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord>;
}
