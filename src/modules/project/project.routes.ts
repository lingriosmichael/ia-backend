import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProjectController } from "./project.controller.js";

export async function registerProjectRoutes(
  app: FastifyInstance,
  controller: ProjectController,
  authenticate: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.get(
    "/organizations/:organizationId/projects",
    { preHandler: authenticate },
    controller.listByOrganization.bind(controller),
  );
  app.post(
    "/organizations/:organizationId/projects",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.get("/projects/:projectId", { preHandler: authenticate }, controller.getById.bind(controller));
  app.get(
    "/projects/:projectId/overview",
    { preHandler: authenticate },
    controller.getOverview.bind(controller),
  );
  app.patch(
    "/projects/:projectId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
  app.delete(
    "/projects/:projectId",
    { preHandler: authenticate },
    controller.delete.bind(controller),
  );
}
