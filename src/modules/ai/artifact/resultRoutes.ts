import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResultController } from "./resultController.js";

export async function registerResultRoutes(
  app: FastifyInstance,
  controller: ResultController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/activities/:activityId/results",
    { preHandler: authenticate },
    controller.listByActivity.bind(controller),
  );
  app.post(
    "/projects/:projectId/results",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.patch(
    "/results/:resultRecordId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
}
