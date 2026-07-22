import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { UploadMetadataController } from "./uploadMetadataController.js";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";

export async function registerUploadMetadataRoutes(
  app: FastifyInstance,
  controller: UploadMetadataController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/activities/:activityId/evidence",
    { preHandler: authenticate },
    controller.listByActivity.bind(controller),
  );
  app.delete(
    "/evidence/:evidenceId",
    { preHandler: authenticate },
    controller.delete.bind(controller),
  );
  app.post(
    "/evidence/:evidenceId/analyse",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.analyse.bind(controller),
  );
  app.get(
    "/evidence/:evidenceId/file",
    { preHandler: authenticate },
    controller.getFile.bind(controller),
  );
}
