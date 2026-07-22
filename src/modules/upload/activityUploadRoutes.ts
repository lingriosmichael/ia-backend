import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ActivityUploadController } from "./activityUploadController.js";
import { uploadRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";

export async function registerActivityUploadRoutes(
  app: FastifyInstance,
  controller: ActivityUploadController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/activities/:activityId/evidence",
    {
      preHandler: authenticate,
      config: uploadRateLimitConfig,
    },
    controller.upload.bind(controller),
  );
}
