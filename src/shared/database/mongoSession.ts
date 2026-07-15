import type { ClientSession } from "mongoose";
import type { DatabaseSession } from "./databaseClient.js";

export function getMongoSessionOptions(session: DatabaseSession): {
  session?: ClientSession;
} {
  return session ? { session } : {};
}

export function applyMongoSession<
  T extends { session(session: ClientSession): T },
>(query: T, session: DatabaseSession): T {
  return session ? query.session(session) : query;
}
