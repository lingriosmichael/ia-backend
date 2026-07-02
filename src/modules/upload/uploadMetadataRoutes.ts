import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { UploadMetadataController } from "./uploadMetadataController.js";

export async function registerUploadMetadataRoutes(
  app: FastifyInstance,
  controller: UploadMetadataController,
  authenticate: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.get(
    "/activities/:activityId/upload-metadata",
    { preHandler: authenticate },
    controller.listByActivity.bind(controller),
  );
  app.post(
    "/projects/:projectId/upload-metadata",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.patch(
    "/upload-metadata/:uploadMetadataId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
}
