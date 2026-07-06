import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProcessingJobController } from "./processingJobController.js";

export async function registerProcessingJobRoutes(
  app: FastifyInstance,
  controller: ProcessingJobController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
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
  app.patch(
    "/jobs/:processingJobId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
}
