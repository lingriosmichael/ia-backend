import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { successResponse } from "../../shared/http/api-response.js";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  idParamSchema,
} from "../../schemas/http-schemas.js";
import { InvitationService } from "./invitation.service.js";

export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  async listByOrganization(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const invitations = await this.invitationService.listForOrganization(
      request.auth.userId,
      params.organizationId!,
    );
    return successResponse(invitations);
  }

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createInvitationSchema.parse(request.body);
    const invitation = await this.invitationService.create(
      request.auth.userId,
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

  async accept(request: FastifyRequest) {
    const params = idParamSchema.parse(request.params);
    const payload = acceptInvitationSchema.parse(request.body);
    const accepted = await this.invitationService.accept(params.token!, payload);
    return successResponse(accepted);
  }

  async revoke(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const invitation = await this.invitationService.revoke(
      request.auth.userId,
      params.organizationId!,
      params.invitationId!,
    );
    return successResponse(invitation);
  }
}
