import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { OrganizationController } from "./organizationController.js";

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  controller: OrganizationController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/organizations",
    { preHandler: authenticate },
    controller.list.bind(controller),
  );
  app.post(
    "/organizations",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.patch(
    "/organizations/:organizationId",
    { preHandler: authenticate },
    controller.update.bind(controller),
  );
  app.get(
    "/organizations/:organizationId/members",
    { preHandler: authenticate },
    controller.listMembers.bind(controller),
  );
  app.delete(
    "/organizations/:organizationId/members/:membershipId",
    { preHandler: authenticate },
    controller.removeMember.bind(controller),
  );
  app.get(
    "/organizations/:organizationId/logo",
    controller.getLogo.bind(controller),
  );
  app.get(
    "/organizations/:organizationId/workspace",
    { preHandler: authenticate },
    controller.getWorkspace.bind(controller),
  );
}
