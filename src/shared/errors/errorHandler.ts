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
      // Every failure that reaches this handler is logged here, once, so
      // "what failed and why" is visible for any endpoint without needing
      // logging sprinkled into each individual service. 5xx is a genuine
      // operational failure (e.g. the Python service unreachable or
      // returning a malformed response); 4xx is expected control flow
      // (bad login, not found, validation) but still worth a server-side
      // trace — a spike of failed logins or forbidden-access attempts
      // should be visible, not silent just because the client, not the
      // server, was "at fault".
      const logPayload = {
        method: request.method,
        url: request.url,
        statusCode: error.statusCode,
        code: error.code,
      };
      if (error.statusCode >= 500) {
        request.log.error({ ...logPayload, err: error }, "AppError");
      } else {
        request.log.warn(logPayload, "AppError");
      }

      return reply.code(error.statusCode).send(
        errorResponse({
          code: error.code,
          message: error.message,
          details: error.details,
        }),
      );
    }

    if (error instanceof ZodError) {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: 400,
          code: "validation_error",
          details: error.flatten(),
        },
        "Request validation failed",
      );

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
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: error.statusCode,
          code: error.code ?? "request_error",
        },
        "Request rejected",
      );

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
    request.log.error(
      { method: request.method, url: request.url, statusCode: 500, err: error },
      "Unhandled error",
    );

    return reply.code(500).send(
      errorResponse({
        code: "internal_error",
        message: "Unexpected server error.",
      }),
    );
  });
}
