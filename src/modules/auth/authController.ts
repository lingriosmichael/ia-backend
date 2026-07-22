import type { FastifyReply, FastifyRequest } from "fastify";
import type { BackendConfig } from "../../shared/config/env.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { loginSchema, registerSchema } from "../../schemas/httpSchemas.js";
import { AuthService } from "./authService.js";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import {
  clearSessionCookie,
  setSessionCookie,
} from "../../shared/auth/sessionCookie.js";

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: BackendConfig,
  ) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const payload = registerSchema.parse(request.body);
    const result = await this.authService.register(payload);
    setSessionCookie(
      reply,
      this.config,
      result.sessionToken,
      result.response.expiresInSeconds,
    );
    return reply.code(201).send(successResponse(result.response));
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const payload = loginSchema.parse(request.body);
    const result = await this.authService.login(payload);
    setSessionCookie(
      reply,
      this.config,
      result.sessionToken,
      result.response.expiresInSeconds,
    );
    return reply.send(successResponse(result.response));
  }

  async me(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const response = await this.authService.getSession(auth.userId);
    return successResponse(response);
  }

  async logout(_request: FastifyRequest, reply: FastifyReply) {
    clearSessionCookie(reply, this.config);
    return reply.send(successResponse({ loggedOut: true }));
  }
}
