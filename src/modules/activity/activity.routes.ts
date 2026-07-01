import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ActivityController } from "./activity.controller.js";

export async function registerActivityRoutes(
  app: FastifyInstance,
  controller: ActivityController,
  authenticate: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.get(
    "/projects/:projectId/activities",
    { preHandler: authenticate },
    controller.listByProject.bind(controller),
  );
  app.post(
    "/projects/:projectId/activities",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.get(
    "/activities/:activityId",
    { preHandler: authenticate },
    controller.getById.bind(controller),
  );
  app.patch(
    "/activities/:activityId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
}
