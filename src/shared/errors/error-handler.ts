import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error.js";
import { errorResponse } from "../http/api-response.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
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

    return reply.code(500).send(
      errorResponse({
        code: "internal_error",
        message: "Unexpected server error.",
      }),
    );
  });
}
