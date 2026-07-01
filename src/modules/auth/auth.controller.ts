import type { FastifyReply, FastifyRequest } from "fastify";
import { successResponse } from "../../shared/http/api-response.js";
import { loginSchema, registerSchema } from "../../schemas/http-schemas.js";
import { AuthService } from "./auth.service.js";
import { AppError } from "../../shared/errors/app-error.js";

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
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const response = await this.authService.getSession(request.auth.userId);
    return successResponse(response);
  }
}
