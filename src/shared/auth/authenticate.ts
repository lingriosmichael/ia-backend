import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/appError.js";
import { AuthService } from "../../modules/auth/authService.js";
import type { BackendConfig } from "../config/env.js";
import { readSessionCookieToken } from "./sessionCookie.js";

type AuthenticationToken = {
  value: string;
  // A Bearer token in an Authorization header is immune to CSRF — a
  // cross-site page has no way to make the browser attach one. A session
  // cookie is not: the browser attaches it automatically, even to
  // requests triggered by another site. Callers use this to scope the
  // same-origin check below to cookie-authenticated requests only.
  source: "header" | "cookie";
};

function readAuthenticationToken(
  request: FastifyRequest,
  config: BackendConfig,
): AuthenticationToken | null {
  const authorizationHeader = request.headers.authorization;

  if (authorizationHeader?.startsWith("Bearer ")) {
    const bearerToken = authorizationHeader.replace("Bearer ", "").trim();
    return bearerToken ? { value: bearerToken, source: "header" } : null;
  }

  const cookieToken = readSessionCookieToken(request, config);
  return cookieToken ? { value: cookieToken, source: "cookie" } : null;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestOrigin(request: FastifyRequest): string | null {
  const originHeader = request.headers.origin;
  if (originHeader) {
    return originHeader;
  }

  const refererHeader = request.headers.referer;
  if (!refererHeader) {
    return null;
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    return null;
  }
}

// CSRF guard for cookie-authenticated requests: SameSite=None (required
// because ia_webapp and this API are deployed on different sites) means the
// browser will attach the session cookie to a request this API's own CORS
// policy never approved — CORS only stops the attacker's page from reading
// the response, not from sending the request. Since there is exactly one
// legitimate caller (CORS_ORIGIN), requiring an exact match on
// Origin/Referer for every state-changing request is sufficient and
// doesn't need a separate CSRF token.
function assertSameOriginForCookieAuth(
  request: FastifyRequest,
  config: BackendConfig,
) {
  if (!STATE_CHANGING_METHODS.has(request.method)) {
    return;
  }

  if (requestOrigin(request) !== config.CORS_ORIGIN) {
    throw new AppError(
      "Cross-site request rejected.",
      403,
      "cross_site_request_rejected",
    );
  }
}

export function createAuthenticateMiddleware(
  config: BackendConfig,
  authService: AuthService,
) {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const token = readAuthenticationToken(request, config);
    if (!token) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    if (token.source === "cookie") {
      assertSameOriginForCookieAuth(request, config);
    }

    try {
      request.auth = authService.verifyToken(token.value);
    } catch {
      throw new AppError(
        "Authentication token is invalid.",
        401,
        "invalid_token",
      );
    }

    // Every subsequent log line for this request — including the built-in
    // access log and any error logged by the central error handler — now
    // carries the caller's identity, so a reported problem can be traced
    // back to the specific user and request that caused it.
    request.log = request.log.child({ userId: request.auth.userId });
  };
}

export function createAuthenticateIfPresentMiddleware(
  config: BackendConfig,
  authService: AuthService,
) {
  return async function authenticateIfPresent(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const token = readAuthenticationToken(request, config);
    if (!token) {
      return;
    }

    if (token.source === "cookie") {
      assertSameOriginForCookieAuth(request, config);
    }

    try {
      request.auth = authService.verifyToken(token.value);
    } catch {
      throw new AppError(
        "Authentication token is invalid.",
        401,
        "invalid_token",
      );
    }

    // Every subsequent log line for this request — including the built-in
    // access log and any error logged by the central error handler — now
    // carries the caller's identity, so a reported problem can be traced
    // back to the specific user and request that caused it.
    request.log = request.log.child({ userId: request.auth.userId });
  };
}
