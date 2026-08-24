import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  createProjectOutcomeStatementSchema,
  idParamSchema,
  updateProjectOutcomeStatementSchema,
} from "../../schemas/httpSchemas.js";
import { ProjectOutcomeStatementService } from "./projectOutcomeStatementService.js";
import { requireParam } from "../../shared/http/requireParam.js";

export class ProjectOutcomeStatementController {
  constructor(
    private readonly projectOutcomeStatementService: ProjectOutcomeStatementService,
  ) {}

  async list(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const statements = await this.projectOutcomeStatementService.listForProject(
      auth.userId,
      requireParam(params, "projectId"),
    );
    return successResponse(statements);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const payload = createProjectOutcomeStatementSchema.parse(request.body);
    const statement = await this.projectOutcomeStatementService.create(
      auth.userId,
      requireParam(params, "projectId"),
      payload,
    );
    return successResponse(statement);
  }

  async update(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const payload = updateProjectOutcomeStatementSchema.parse(request.body);
    const statement = await this.projectOutcomeStatementService.update(
      auth.userId,
      requireParam(params, "projectId"),
      requireParam(params, "outcomeStatementId"),
      payload,
    );
    return successResponse(statement);
  }

  async delete(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const statement = await this.projectOutcomeStatementService.delete(
      auth.userId,
      requireParam(params, "projectId"),
      requireParam(params, "outcomeStatementId"),
    );
    return successResponse(statement);
  }
}
