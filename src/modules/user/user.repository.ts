import type { DatabaseSession } from "../../shared/database/database-client.js";
import type {
  UserCreateInput,
  UserPersistenceRecord,
} from "./user.persistence.js";

export interface UserRepository {
  findByEmail(
    email: string,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord | null>;
  findById(id: string, session: DatabaseSession): Promise<UserPersistenceRecord | null>;
  create(
    input: UserCreateInput,
    session: DatabaseSession,
  ): Promise<UserPersistenceRecord>;
}
