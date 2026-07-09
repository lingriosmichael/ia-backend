import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/appError.js";

// Mirrors ia_python_service's require_internal_service_token guard — this
// is the reverse direction (Python calling back into this backend), using
// the same shared secret. Only ia_python_service should ever call routes
// protected by this.
export function createRequireInternalServiceSecretMiddleware(
  sharedSecret: string,
) {
  const expected = Buffer.from(sharedSecret);

  return async function requireInternalServiceSecret(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const provided = request.headers["x-internal-service-token"];

    if (typeof provided !== "string" || provided.length === 0) {
      throw new AppError("Unauthorized.", 401, "unauthorized");
    }

    const providedBuffer = Buffer.from(provided);
    const isValid =
      providedBuffer.length === expected.length &&
      timingSafeEqual(providedBuffer, expected);

    if (!isValid) {
      throw new AppError("Unauthorized.", 401, "unauthorized");
    }
  };
}
