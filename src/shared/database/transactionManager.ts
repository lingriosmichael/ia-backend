import type { DatabaseSession } from "./databaseClient.js";
import { databaseSession } from "./databaseClient.js";

export interface TransactionManager {
  runInTransaction<T>(operation: (session: DatabaseSession) => Promise<T>): Promise<T>;
}

export class NoopTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    return operation(databaseSession);
  }
}
