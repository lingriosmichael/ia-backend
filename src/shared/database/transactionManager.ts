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

function isStandaloneTransactionUnsupportedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: number;
    codeName?: string;
    message?: string;
    errmsg?: string;
  };

  return (
    candidate.code === 20 ||
    candidate.codeName === "IllegalOperation" ||
    candidate.message?.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    ) === true ||
    candidate.errmsg?.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    ) === true
  );
}

async function abortTransactionSafely(session: mongoose.mongo.ClientSession) {
  try {
    await session.abortTransaction();
  } catch {
    // Ignore abort failures when falling back to a deployment that does not
    // support Mongo transactions.
  }
}

export class MongoTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (isStandaloneTransactionUnsupportedError(error)) {
        if (transactionStarted) {
          await abortTransactionSafely(session);
        }

        return operation(databaseSession);
      }

      if (transactionStarted) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }
}
