import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProcessingJobController } from "./processingJobController.js";

export async function registerProcessingJobRoutes(
  app: FastifyInstance,
  controller: ProcessingJobController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  requireInternalServiceSecret: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.get(
    "/activities/:activityId/jobs",
    { preHandler: authenticate },
    controller.listByActivity.bind(controller),
  );
  app.get(
    "/jobs/:processingJobId",
    { preHandler: authenticate },
    controller.getById.bind(controller),
  );
  app.post(
    "/jobs/:processingJobId/sync",
    { preHandler: authenticate },
    controller.sync.bind(controller),
  );
  app.post(
    "/jobs/:processingJobId/cancel",
    { preHandler: authenticate },
    controller.cancel.bind(controller),
  );
  app.post(
    "/internal/processing-jobs/claim",
    { preHandler: requireInternalServiceSecret },
    controller.claimInternally.bind(controller),
  );
  app.post(
    "/internal/processing-jobs/:processingJobId/heartbeat",
    { preHandler: requireInternalServiceSecret },
    controller.heartbeatInternally.bind(controller),
  );
  app.get(
    "/internal/processing-jobs/:processingJobId/source-file",
    { preHandler: requireInternalServiceSecret },
    controller.getSourceFileInternally.bind(controller),
  );
  app.post(
    "/internal/processing-jobs/:processingJobId/complete",
    { preHandler: requireInternalServiceSecret },
    controller.completeExternally.bind(controller),
  );
}
