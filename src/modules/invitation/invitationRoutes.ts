import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InvitationController } from "./invitationController.js";

export async function registerInvitationRoutes(
  app: FastifyInstance,
  controller: InvitationController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  authenticateIfPresent: (
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
  app.post(
    "/organizations/:organizationId/invitations/:invitationId/resend",
    { preHandler: authenticate },
    controller.resend.bind(controller),
  );
  app.delete(
    "/organizations/:organizationId/invitations/:invitationId",
    { preHandler: authenticate },
    controller.revoke.bind(controller),
  );
  app.get("/invitations/:token", controller.getByToken.bind(controller));
  app.post(
    "/invitations/:token/accept",
    { preHandler: authenticateIfPresent },
    controller.accept.bind(controller),
  );
}
