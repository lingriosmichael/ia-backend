import type { FastifyReply, FastifyRequest } from "fastify";
import { successResponse } from "../../shared/http/apiResponse.js";
import { loginSchema, registerSchema } from "../../schemas/httpSchemas.js";
import { AuthService } from "./authService.js";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const payload = registerSchema.parse(request.body);
    const response = await this.authService.register(payload);
    return reply.code(201).send(successResponse(response));
  }

  async login(request: FastifyRequest) {
    const payload = loginSchema.parse(request.body);
    const response = await this.authService.login(payload);
    return successResponse(response);
  }

  async me(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const response = await this.authService.getSession(auth.userId);
    return successResponse(response);
  }
}
