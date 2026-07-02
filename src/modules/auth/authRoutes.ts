import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthController } from "./authController.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  controller: AuthController,
  authenticate: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.post("/auth/register", controller.register.bind(controller));
  app.post("/auth/login", controller.login.bind(controller));
  app.get("/auth/me", { preHandler: authenticate }, controller.me.bind(controller));
}
