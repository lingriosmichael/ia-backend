import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { BackendConfig } from "../../shared/config/env.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { UserRepository } from "../user/userRepository.js";
import { AuthService } from "./authService.js";

const config = {
  JWT_SECRET: "a".repeat(32),
  JWT_EXPIRES_IN: "7d",
} as unknown as BackendConfig;

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as import("fastify").FastifyBaseLogger;

test("register converts a duplicate-key error into a clean email_already_exists 409 instead of a raw 500", async () => {
  // Regression test: register()'s findByEmail existence check isn't atomic
  // with the create() call that follows it, so two concurrent registrations
  // for the same email (a common double-submit scenario) can both pass the
  // check. Without a catch around create(), the second request's raw Mongo
  // duplicate-key error used to surface as an opaque 500 instead of the
  // same clean 409 the first request gets from the check above. See
  // authService.ts's register().
  const userRepository = {
    findByEmail: async () => null,
    create: async () => {
      const duplicateKeyError = new Error(
        "E11000 duplicate key error",
      ) as Error & {
        code: number;
      };
      duplicateKeyError.code = 11000;
      throw duplicateKeyError;
    },
  } as unknown as UserRepository;

  const organizationRepository = {} as OrganizationRepository;
  const transactionManager = {} as TransactionManager;

  const authService = new AuthService(
    config,
    userRepository,
    organizationRepository,
    transactionManager,
    logger,
  );

  await assert.rejects(
    authService.register({
      fullName: "New User",
      email: "duplicate@example.org",
      password: "correct horse battery staple",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "email_already_exists");
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

test("register rejects up front, without hashing a password or calling create, when the email already exists", async () => {
  let createCalled = false;
  const userRepository = {
    findByEmail: async () => ({
      id: "user-1",
      email: "existing@example.org",
      fullName: "Existing User",
      passwordHash: "hash",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    create: async () => {
      createCalled = true;
      throw new Error(
        "create() must not be called when the email already exists",
      );
    },
  } as unknown as UserRepository;

  const authService = new AuthService(
    config,
    userRepository,
    {} as OrganizationRepository,
    {} as TransactionManager,
    logger,
  );

  await assert.rejects(
    authService.register({
      fullName: "Existing User",
      email: "existing@example.org",
      password: "correct horse battery staple",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "email_already_exists");
      return true;
    },
  );
  assert.equal(createCalled, false);
});
