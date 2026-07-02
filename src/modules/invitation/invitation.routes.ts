import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InvitationController } from "./invitation.controller.js";

export async function registerInvitationRoutes(
  app: FastifyInstance,
  controller: InvitationController,
  authenticate: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
) {
  app.get(
    "/organizations/:organizationId/invitations",
    { preHandler: authenticate },
    controller.listByOrganization.bind(controller),
  );
  app.post(
    "/organizations/:organizationId/invitations",
    { preHandler: authenticate },
    controller.create.bind(controller),
  );
  app.delete(
    "/organizations/:organizationId/invitations/:invitationId",
    { preHandler: authenticate },
    controller.revoke.bind(controller),
  );
  app.get("/invitations/:token", controller.getByToken.bind(controller));
  app.post("/invitations/:token/accept", controller.accept.bind(controller));
}
