import mongoose from "mongoose";
import type { DatabaseSession } from "./databaseClient.js";
import { databaseSession } from "./databaseClient.js";

export interface TransactionManager {
  runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T>;
}

export class NoopTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    return operation(databaseSession);
  }
}

export class MongoTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
