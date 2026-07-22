import type { FastifyRequest } from "fastify";

type RouteRateLimitConfig = {
  rateLimit: {
    hook: "preHandler";
    max: number;
    timeWindow: string;
    keyGenerator: (request: FastifyRequest) => string;
  };
};

function byAuthenticatedUser(
  max: number,
  timeWindow: string,
): RouteRateLimitConfig {
  return {
    rateLimit: {
      hook: "preHandler",
      max,
      timeWindow,
      keyGenerator: (request) => request.auth?.userId ?? request.ip,
    },
  };
}

export const uploadRateLimitConfig = byAuthenticatedUser(20, "10 minutes");
export const processingKickoffRateLimitConfig = byAuthenticatedUser(
  12,
  "10 minutes",
);
export const analyticsGenerationRateLimitConfig = byAuthenticatedUser(
  8,
  "10 minutes",
);
export const analyticsExportRateLimitConfig = byAuthenticatedUser(
  20,
  "10 minutes",
);
