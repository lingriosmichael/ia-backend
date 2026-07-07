import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PrivacyReviewController } from "./privacyReviewController.js";

export async function registerPrivacyReviewRoutes(
  app: FastifyInstance,
  controller: PrivacyReviewController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/privacy-review/:processingJobId",
    { preHandler: authenticate },
    controller.getByProcessingJobId.bind(controller),
  );

  app.post(
    "/privacy-review/:processingJobId/approve",
    { preHandler: authenticate },
    controller.approve.bind(controller),
  );
}
