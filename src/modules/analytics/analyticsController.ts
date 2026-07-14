import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import type { AnalyticsExecutionService } from "./analyticsExecutionService.js";
import type { AnalyticsQueryService } from "./analyticsQueryService.js";

export class AnalyticsController {
  constructor(
    private readonly analyticsExecutionService: AnalyticsExecutionService,
    private readonly analyticsQueryService: AnalyticsQueryService,
  ) {}

  async generateForProject(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const execution = await this.analyticsExecutionService.generateForProject(
      auth.userId,
      params.projectId!,
    );
    return successResponse(execution);
  }

  async getProjectAnalytics(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const response = await this.analyticsQueryService.getProjectAnalytics(
      auth.userId,
      params.projectId!,
    );
    return successResponse(response);
  }

  async generateForActivity(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const execution = await this.analyticsExecutionService.generateForActivity(
      auth.userId,
      params.projectId!,
      params.activityId!,
    );
    return successResponse(execution);
  }

  async getActivityAnalytics(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const response = await this.analyticsQueryService.getActivityAnalytics(
      auth.userId,
      params.projectId!,
      params.activityId!,
    );
    return successResponse(response);
  }
}
