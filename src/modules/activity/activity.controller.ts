import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { successResponse } from "../../shared/http/api-response.js";
import {
  createActivitySchema,
  idParamSchema,
  updateActivitySchema,
} from "../../schemas/http-schemas.js";
import { ActivityService } from "./activity.service.js";

export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  async listByProject(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const activities = await this.activityService.listForProject(
      request.auth.userId,
      params.projectId!,
    );
    return successResponse(activities);
  }

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createActivitySchema.parse(request.body);
    const activity = await this.activityService.create(
      request.auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(activity);
  }

  async getById(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const activity = await this.activityService.getById(
      request.auth.userId,
      params.activityId!,
    );
    return successResponse(activity);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = updateActivitySchema.parse(request.body);
    const activity = await this.activityService.update(
      request.auth.userId,
      params.activityId!,
      payload,
    );
    return successResponse(activity);
  }
}
