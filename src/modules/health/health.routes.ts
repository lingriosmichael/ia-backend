import type { FastifyInstance } from "fastify";
import { HealthController } from "./health.controller.js";
import { successResponse } from "../../shared/http/api-response.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  controller: HealthController,
) {
  app.get("/health", async () => successResponse(await controller.getHealth()));
}
