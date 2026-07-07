import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  idParamSchema,
} from "../../schemas/httpSchemas.js";
import { InvitationService } from "./invitationService.js";

export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  async listByOrganization(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const invitations = await this.invitationService.listForOrganization(
      auth.userId,
      params.organizationId!,
    );
    return successResponse(invitations);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = createInvitationSchema.parse(request.body);
    const invitation = await this.invitationService.create(
      auth.userId,
      params.organizationId!,
      payload,
    );
    return successResponse(invitation);
  }

  async getByToken(request: FastifyRequest) {
    const params = idParamSchema.parse(request.params);
    const invitation = await this.invitationService.getByToken(params.token!);
    return successResponse(invitation);
  }

  async resend(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const invitation = await this.invitationService.resend(
      auth.userId,
      params.organizationId!,
      params.invitationId!,
    );
    return successResponse(invitation);
  }

  async accept(request: FastifyRequest) {
    const params = idParamSchema.parse(request.params);
    const payload = acceptInvitationSchema.parse(request.body);
    const accepted = await this.invitationService.accept(params.token!, {
      ...payload,
      authenticatedUserId: request.auth?.userId,
      authenticatedUserEmail: request.auth?.email,
    });
    return successResponse(accepted);
  }

  async revoke(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const invitation = await this.invitationService.revoke(
      auth.userId,
      params.organizationId!,
      params.invitationId!,
    );
    return successResponse(invitation);
  }
}
