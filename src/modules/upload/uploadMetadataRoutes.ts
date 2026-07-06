import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { UploadMetadataController } from "./uploadMetadataController.js";

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
  app.get(
    "/evidence/:evidenceId/file",
    { preHandler: authenticate },
    controller.getFile.bind(controller),
  );
}
