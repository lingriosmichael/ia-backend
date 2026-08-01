import mongoose from "mongoose";
import type { DatabaseSession } from "./databaseClient.js";
import { databaseSession } from "./databaseClient.js";

export interface TransactionManager {
  runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T>;
}

interface TransactionFallbackLogger {
  warn(payload: unknown, message: string): void;
}

export class NoopTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    return operation(databaseSession);
  }
}

function isStandaloneTransactionUnsupportedError(
  error: unknown,
  options: { allowLooseCodeName: boolean } = { allowLooseCodeName: true },
): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: number;
    codeName?: string;
    message?: string;
    errmsg?: string;
    cause?: unknown;
    originalError?: unknown;
    errorResponse?: unknown;
  };

  const isDirectMatch =
    candidate.code === 20 ||
    (options.allowLooseCodeName && candidate.codeName === "IllegalOperation") ||
    candidate.message?.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    ) === true ||
    candidate.message?.includes(
      "This MongoDB deployment does not support retryable writes",
    ) === true ||
    candidate.errmsg?.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    ) === true ||
    candidate.errmsg?.includes(
      "This MongoDB deployment does not support retryable writes",
    ) === true;

  if (isDirectMatch) {
    return true;
  }

  return (
    isStandaloneTransactionUnsupportedError(candidate.cause, {
      allowLooseCodeName: false,
    }) ||
    isStandaloneTransactionUnsupportedError(candidate.originalError, {
      allowLooseCodeName: false,
    }) ||
    isStandaloneTransactionUnsupportedError(candidate.errorResponse, {
      allowLooseCodeName: false,
    })
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
  constructor(private readonly logger?: TransactionFallbackLogger) {}

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

        this.logger?.warn(
          { error },
          "Mongo transactions are unsupported by the current deployment. Retrying without a transaction.",
        );

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
