import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthController } from "./authController.js";

// Deliberately IP-keyed (Fastify's default), not per-authenticated-user:
// there is no user identity yet at register/login time to key on, unlike
// rate limits elsewhere in this codebase that key by authenticated user.
const authRateLimitConfig = {
  rateLimit: {
    max: 5,
    timeWindow: "1 minute",
  },
};

export async function registerAuthRoutes(
  app: FastifyInstance,
  controller: AuthController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/auth/register",
    { config: authRateLimitConfig },
    controller.register.bind(controller),
  );
  app.post(
    "/auth/login",
    { config: authRateLimitConfig },
    controller.login.bind(controller),
  );
  app.get(
    "/auth/me",
    { preHandler: authenticate },
    controller.me.bind(controller),
  );
  app.post("/auth/logout", controller.logout.bind(controller));
}
