import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoTransactionManager } from "./transactionManager.js";

type SessionStub = Awaited<ReturnType<typeof mongoose.startSession>>;

function createLoggerStub() {
  const warnCalls: Array<{ payload: unknown; message: string }> = [];

  return {
    warnCalls,
    logger: {
      warn: (payload: unknown, message: string) => {
        warnCalls.push({ payload, message });
      },
    },
  };
}

function createSessionStub() {
  const calls: string[] = [];

  const session = {
    startTransaction: () => {
      calls.push("startTransaction");
    },
    commitTransaction: async () => {
      calls.push("commitTransaction");
    },
    abortTransaction: async () => {
      calls.push("abortTransaction");
    },
    endSession: async () => {
      calls.push("endSession");
    },
  } as SessionStub;

  return { calls, session };
}

test("transaction manager commits when Mongo transactions are supported", async () => {
  const originalStartSession = mongoose.startSession;
  const { calls, session } = createSessionStub();
  const { logger, warnCalls } = createLoggerStub();

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager(logger);
    const seenSessions: unknown[] = [];

    const result = await manager.runInTransaction(async (databaseSession) => {
      seenSessions.push(databaseSession);
      return "ok";
    });

    assert.equal(result, "ok");
    assert.equal(seenSessions.length, 1);
    assert.equal(seenSessions[0], session);
    assert.deepEqual(calls, [
      "startTransaction",
      "commitTransaction",
      "endSession",
    ]);
    assert.deepEqual(warnCalls, []);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("transaction manager falls back to a non-transactional operation on standalone Mongo", async () => {
  const originalStartSession = mongoose.startSession;
  const { calls, session } = createSessionStub();
  const { logger, warnCalls } = createLoggerStub();

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager(logger);
    const seenSessions: unknown[] = [];

    const result = await manager.runInTransaction(async (databaseSession) => {
      seenSessions.push(databaseSession);

      if (databaseSession !== null) {
        const error = new Error(
          "Transaction numbers are only allowed on a replica set member or mongos",
        ) as Error & { code?: number; codeName?: string };
        error.code = 20;
        error.codeName = "IllegalOperation";
        throw error;
      }

      return "fallback";
    });

    assert.equal(result, "fallback");
    assert.deepEqual(seenSessions, [session, null]);
    assert.deepEqual(calls, [
      "startTransaction",
      "abortTransaction",
      "endSession",
    ]);
    assert.equal(warnCalls.length, 1);
    assert.equal(
      warnCalls[0]?.message,
      "Mongo transactions are unsupported by the current deployment. Retrying without a transaction.",
    );
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("transaction manager falls back when Mongo wraps standalone transaction errors", async () => {
  const originalStartSession = mongoose.startSession;
  const { calls, session } = createSessionStub();
  const { logger, warnCalls } = createLoggerStub();

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager(logger);
    const seenSessions: unknown[] = [];

    const result = await manager.runInTransaction(async (databaseSession) => {
      seenSessions.push(databaseSession);

      if (databaseSession !== null) {
        const nestedError = new Error(
          "Standalone Mongo transaction error.",
        ) as Error & { code?: number; codeName?: string };
        nestedError.code = 20;
        nestedError.codeName = "IllegalOperation";

        const wrappedError = new Error(
          "Wrapped Mongo server error.",
        ) as Error & {
          originalError?: unknown;
          errorResponse?: { originalError?: unknown };
        };
        wrappedError.originalError = nestedError;
        wrappedError.errorResponse = { originalError: nestedError };
        throw wrappedError;
      }

      return "fallback";
    });

    assert.equal(result, "fallback");
    assert.deepEqual(seenSessions, [session, null]);
    assert.deepEqual(calls, [
      "startTransaction",
      "abortTransaction",
      "endSession",
    ]);
    assert.equal(warnCalls.length, 1);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("transaction manager does not fall back on a nested generic IllegalOperation codeName alone", async () => {
  const originalStartSession = mongoose.startSession;
  const { calls, session } = createSessionStub();
  const { logger, warnCalls } = createLoggerStub();

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager(logger);

    await assert.rejects(
      manager.runInTransaction(async (databaseSession) => {
        if (databaseSession !== null) {
          const nestedError = new Error(
            "Generic illegal operation.",
          ) as Error & {
            codeName?: string;
          };
          nestedError.codeName = "IllegalOperation";

          const wrappedError = new Error(
            "Wrapped Mongo server error.",
          ) as Error & {
            cause?: unknown;
          };
          wrappedError.cause = nestedError;
          throw wrappedError;
        }

        return "unexpected fallback";
      }),
    );

    assert.deepEqual(calls, [
      "startTransaction",
      "abortTransaction",
      "endSession",
    ]);
    assert.deepEqual(warnCalls, []);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});
