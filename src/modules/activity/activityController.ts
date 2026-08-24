import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  createActivitySchema,
  idParamSchema,
  updateActivitySchema,
} from "../../schemas/httpSchemas.js";
import { ActivityService } from "./activityService.js";
import { requireParam } from "../../shared/http/requireParam.js";

export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  async listByProject(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const activities = await this.activityService.listForProject(
      auth.userId,
      requireParam(params, "projectId"),
    );
    return successResponse(activities);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = createActivitySchema.parse(request.body);
    const activity = await this.activityService.create(
      auth.userId,
      requireParam(params, "projectId"),
      payload,
    );
    return successResponse(activity);
  }

  async getById(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const activity = await this.activityService.getById(
      auth.userId,
      requireParam(params, "activityId"),
    );
    return successResponse(activity);
  }

  async update(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = updateActivitySchema.parse(request.body);
    const activity = await this.activityService.update(
      auth.userId,
      requireParam(params, "activityId"),
      payload,
    );
    return successResponse(activity);
  }

  async delete(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const activity = await this.activityService.delete(
      auth.userId,
      requireParam(params, "activityId"),
    );
    return successResponse(activity);
  }
}
