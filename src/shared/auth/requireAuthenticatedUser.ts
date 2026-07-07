import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/appError.js";

export function requireAuthenticatedUser(request: FastifyRequest): {
  userId: string;
  email: string;
} {
  if (!request.auth) {
    throw new AppError("Authentication is required.", 401, "unauthorized");
  }

  return request.auth;
}
