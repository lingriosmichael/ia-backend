import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ActivityUploadController } from "./activityUploadController.js";

export async function registerActivityUploadRoutes(
  app: FastifyInstance,
  controller: ActivityUploadController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/activities/:activityId/uploads",
    { preHandler: authenticate },
    controller.upload.bind(controller),
  );
}
