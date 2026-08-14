import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";
import { QualitativeCodingReviewController } from "./qualitativeCodingReviewController.js";

export async function registerQualitativeCodingReviewRoutes(
  app: FastifyInstance,
  controller: QualitativeCodingReviewController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/qualitative-coding-review/:uploadMetadataId",
    { preHandler: authenticate },
    controller.getByUploadMetadataId.bind(controller),
  );

  app.post(
    "/qualitative-coding-review/:uploadMetadataId/generate",
    { preHandler: authenticate, config: processingKickoffRateLimitConfig },
    controller.generate.bind(controller),
  );

  app.post(
    "/qualitative-coding-review/:uploadMetadataId/approve",
    { preHandler: authenticate },
    controller.approve.bind(controller),
  );
}
