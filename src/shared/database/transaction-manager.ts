import type { DatabaseSession } from "./database-client.js";
import { databaseSession } from "./database-client.js";

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
