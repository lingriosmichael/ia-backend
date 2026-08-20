import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProjectOutcomeStatementController } from "./projectOutcomeStatementController.js";

export async function registerProjectOutcomeStatementRoutes(
  app: FastifyInstance,
  controller: ProjectOutcomeStatementController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/projects/:projectId/outcome-statements",
    { preHandler: authenticate },
    controller.list.bind(controller),
  );
  app.post(
    "/projects/:projectId/outcome-statements",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.patch(
    "/projects/:projectId/outcome-statements/:outcomeStatementId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
  app.delete(
    "/projects/:projectId/outcome-statements/:outcomeStatementId",
    { preHandler: authenticate },
    controller.delete.bind(controller),
  );
}
