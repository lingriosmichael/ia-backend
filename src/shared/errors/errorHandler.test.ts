import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./appError.js";
import { registerErrorHandler } from "./errorHandler.js";

function captureErrorHandler() {
  let handler: (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => unknown;
  const fakeApp = {
    setErrorHandler: (fn: typeof handler) => {
      handler = fn;
    },
  } as unknown as FastifyInstance;

  registerErrorHandler(fakeApp);
  return (error: unknown) => {
    const loggedErrors: unknown[] = [];
    const sent: { statusCode: number; body: unknown }[] = [];
    const request = {
      log: { error: (...args: unknown[]) => loggedErrors.push(args) },
    } as unknown as FastifyRequest;
    const reply = {
      code: (statusCode: number) => ({
        send: (body: unknown) => {
          sent.push({ statusCode, body });
          return reply;
        },
      }),
    } as unknown as FastifyReply;

    handler(error, request, reply);
    return { loggedErrors, sent };
  };
}

test("errorHandler logs a 5xx AppError server-side (e.g. the Python service being unreachable)", () => {
  const invoke = captureErrorHandler();
  const { loggedErrors, sent } = invoke(
    new AppError(
      "Python service unavailable.",
      502,
      "python_service_unavailable",
    ),
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(sent[0]?.statusCode, 502);
});

test("errorHandler does not log a 4xx AppError (expected control flow, not a bug)", () => {
  const invoke = captureErrorHandler();
  const { loggedErrors, sent } = invoke(
    new AppError("Not found.", 404, "not_found"),
  );

  assert.equal(loggedErrors.length, 0);
  assert.equal(sent[0]?.statusCode, 404);
});
