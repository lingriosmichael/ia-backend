import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./appError.js";
import { errorResponse } from "../http/apiResponse.js";

function isClientErrorWithStatusCode(
  error: unknown,
): error is { statusCode: number; code?: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number" &&
    (error as { statusCode: number }).statusCode >= 400 &&
    (error as { statusCode: number }).statusCode < 500 &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(
        errorResponse({
          code: error.code,
          message: error.message,
          details: error.details,
        }),
      );
    }

    if (error instanceof ZodError) {
      return reply.code(400).send(
        errorResponse({
          code: "validation_error",
          message: "Invalid request payload.",
          details: error.flatten(),
        }),
      );
    }

    // Plugin-thrown errors (e.g. @fastify/rate-limit's 429) set a real
    // statusCode following the standard http-errors convention. Respect it
    // instead of flattening every non-AppError into a 500.
    if (isClientErrorWithStatusCode(error)) {
      return reply.code(error.statusCode).send(
        errorResponse({
          code: error.code ?? "request_error",
          message: error.message,
        }),
      );
    }

    // Every other error is a genuine bug, not expected control flow — log
    // it with the full stack (request.log already carries this request's
    // correlation ID) since without this, an unexpected 500 previously left
    // no server-side trace of what actually happened.
    request.log.error({ err: error }, "Unhandled error");

    return reply.code(500).send(
      errorResponse({
        code: "internal_error",
        message: "Unexpected server error.",
      }),
    );
  });
}
