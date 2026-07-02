import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";
import { AuthService } from "../../modules/auth/auth.service.js";

export function createAuthenticateMiddleware(authService: AuthService) {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const token = authorizationHeader.replace("Bearer ", "").trim();
    if (!token) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    try {
      request.auth = authService.verifyToken(token);
    } catch {
      throw new AppError("Authentication token is invalid.", 401, "invalid_token");
    }
  };
}

export function createAuthenticateIfPresentMiddleware(authService: AuthService) {
  return async function authenticateIfPresent(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return;
    }

    const token = authorizationHeader.replace("Bearer ", "").trim();
    if (!token) {
      return;
    }

    try {
      request.auth = authService.verifyToken(token);
    } catch {
      throw new AppError("Authentication token is invalid.", 401, "invalid_token");
    }
  };
}
