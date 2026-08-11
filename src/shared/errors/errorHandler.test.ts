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
  return (
    error: unknown,
    requestOverrides?: Partial<FastifyRequest>,
  ) => {
    const loggedErrors: unknown[] = [];
    const loggedWarnings: unknown[] = [];
    const sent: { statusCode: number; body: unknown }[] = [];
    const request = {
      method: "GET",
      url: "/test",
      log: {
        error: (...args: unknown[]) => loggedErrors.push(args),
        warn: (...args: unknown[]) => loggedWarnings.push(args),
      },
      ...requestOverrides,
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
    return { loggedErrors, loggedWarnings, sent };
  };
}

test("errorHandler logs a 5xx AppError server-side (e.g. the Python service being unreachable)", () => {
  const invoke = captureErrorHandler();
  const { loggedErrors, loggedWarnings, sent } = invoke(
    new AppError(
      "Python service unavailable.",
      502,
      "python_service_unavailable",
    ),
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedWarnings.length, 0);
  assert.equal(sent[0]?.statusCode, 502);
});

test("errorHandler logs a 4xx AppError as a warning and still returns the client error", () => {
  const invoke = captureErrorHandler();
  const { loggedErrors, loggedWarnings, sent } = invoke(
    new AppError("Not found.", 404, "not_found"),
  );

  assert.equal(loggedErrors.length, 0);
  assert.equal(loggedWarnings.length, 1);
  assert.equal(sent[0]?.statusCode, 404);
});

test("errorHandler stays silent for the expected pre-run analysis-v2 404", () => {
  const invoke = captureErrorHandler();
  const { loggedErrors, loggedWarnings, sent } = invoke(
    new AppError(
      "No ActivityAnalystV2 shadow run exists for this activity yet.",
      404,
      "activity_analysis_v2_not_found",
    ),
    {
      method: "GET",
      url: "/activities/04b69687-ffe8-45d3-a300-babf9db5ebdd/analysis-v2",
    },
  );

  assert.equal(loggedErrors.length, 0);
  assert.equal(loggedWarnings.length, 0);
  assert.equal(sent[0]?.statusCode, 404);
});
