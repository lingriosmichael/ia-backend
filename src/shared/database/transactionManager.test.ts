import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoTransactionManager } from "./transactionManager.js";

type SessionStub = Awaited<ReturnType<typeof mongoose.startSession>>;

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

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager();
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
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("transaction manager falls back to a non-transactional operation on standalone Mongo", async () => {
  const originalStartSession = mongoose.startSession;
  const { calls, session } = createSessionStub();

  mongoose.startSession = async () => session;

  try {
    const manager = new MongoTransactionManager();
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
  } finally {
    mongoose.startSession = originalStartSession;
  }
});
