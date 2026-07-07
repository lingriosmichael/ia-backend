import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  createProjectSchema,
  deleteProjectSchema,
  idParamSchema,
  transferProjectOwnershipSchema,
  updateProjectSchema,
} from "../../schemas/httpSchemas.js";
import { ProjectService } from "./projectService.js";

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  async listByOrganization(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const projects = await this.projectService.listForOrganization(
      auth.userId,
      params.organizationId!,
    );
    return successResponse(projects);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = createProjectSchema.parse(request.body);
    const project = await this.projectService.create(
      auth.userId,
      params.organizationId!,
      payload,
    );
    return successResponse(project);
  }

  async getById(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const project = await this.projectService.getById(
      auth.userId,
      params.projectId!,
    );
    return successResponse(project);
  }

  async getOverview(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const overview = await this.projectService.getOverview(
      auth.userId,
      params.projectId!,
    );
    return successResponse(overview);
  }

  async update(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = updateProjectSchema.parse(request.body);
    const project = await this.projectService.update(
      auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(project);
  }

  async transferOwnership(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = transferProjectOwnershipSchema.parse(request.body);
    const project = await this.projectService.transferOwnership(
      auth.userId,
      params.projectId!,
      payload.newOwnerId,
    );
    return successResponse(project);
  }

  async delete(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = deleteProjectSchema.parse(request.body);
    const deletedProject = await this.projectService.delete(
      auth.userId,
      params.projectId!,
      payload,
    );

    return successResponse(deletedProject);
  }
}
