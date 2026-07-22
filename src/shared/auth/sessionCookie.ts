import type { FastifyReply, FastifyRequest } from "fastify";
import type { BackendConfig } from "../config/env.js";

type SessionCookieConfig = Pick<
  BackendConfig,
  "AUTH_COOKIE_NAME" | "AUTH_COOKIE_SAME_SITE" | "AUTH_COOKIE_SECURE"
>;

function formatSameSite(value: SessionCookieConfig["AUTH_COOKIE_SAME_SITE"]) {
  return value === "none" ? "None" : value === "strict" ? "Strict" : "Lax";
}

function shouldUseSecureCookies(config: SessionCookieConfig) {
  return config.AUTH_COOKIE_SECURE ?? process.env.NODE_ENV === "production";
}

function serializeCookie(
  config: SessionCookieConfig,
  name: string,
  value: string,
  options: {
    maxAgeSeconds: number;
    expires?: Date;
  },
) {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${formatSameSite(config.AUTH_COOKIE_SAME_SITE)}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];

  if (options.expires) {
    segments.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (shouldUseSecureCookies(config)) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

export function readSessionCookieToken(
  request: FastifyRequest,
  config: SessionCookieConfig,
) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    if (rawName !== config.AUTH_COOKIE_NAME) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    if (!rawValue) {
      return null;
    }

    return decodeURIComponent(rawValue);
  }

  return null;
}

export function setSessionCookie(
  reply: FastifyReply,
  config: SessionCookieConfig,
  token: string,
  maxAgeSeconds: number,
) {
  reply.header(
    "set-cookie",
    serializeCookie(config, config.AUTH_COOKIE_NAME, token, { maxAgeSeconds }),
  );
}

export function clearSessionCookie(
  reply: FastifyReply,
  config: SessionCookieConfig,
) {
  reply.header(
    "set-cookie",
    serializeCookie(config, config.AUTH_COOKIE_NAME, "", {
      maxAgeSeconds: 0,
      expires: new Date(0),
    }),
  );
}
