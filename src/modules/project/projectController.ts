import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  createProjectSchema,
  deleteProjectSchema,
  idParamSchema,
  updateProjectSchema,
} from "../../schemas/httpSchemas.js";
import { ProjectService } from "./projectService.js";

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  async listByOrganization(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const projects = await this.projectService.listForOrganization(
      request.auth.userId,
      params.organizationId!,
    );
    return successResponse(projects);
  }

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createProjectSchema.parse(request.body);
    const project = await this.projectService.create(
      request.auth.userId,
      params.organizationId!,
      payload,
    );
    return successResponse(project);
  }

  async getById(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const project = await this.projectService.getById(
      request.auth.userId,
      params.projectId!,
    );
    return successResponse(project);
  }

  async getOverview(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const overview = await this.projectService.getOverview(
      request.auth.userId,
      params.projectId!,
    );
    return successResponse(overview);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = updateProjectSchema.parse(request.body);
    const project = await this.projectService.update(
      request.auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(project);
  }

  async delete(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = deleteProjectSchema.parse(request.body);
    const deletedProject = await this.projectService.delete(
      request.auth.userId,
      params.projectId!,
      payload,
    );

    return successResponse(deletedProject);
  }
}
