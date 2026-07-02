import type { FastifyInstance } from "fastify";
import { HealthController } from "./healthController.js";
import { successResponse } from "../../shared/http/apiResponse.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  controller: HealthController,
) {
  app.get("/health", async () => successResponse(await controller.getHealth()));
}
