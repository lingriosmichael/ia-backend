import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  analyticsDashboardExportRequestSchema,
  analyticsDashboardInteractionSchema,
  analyticsDashboardPreferenceSchema,
  idParamSchema,
} from "../../schemas/httpSchemas.js";
import type { AnalyticsDashboardExportService } from "./analyticsDashboardExportService.js";
import type { AnalyticsDashboardEventService } from "./analyticsDashboardEventService.js";
import type { AnalyticsDashboardPreferenceService } from "./analyticsDashboardPreferenceService.js";
import type { AnalyticsExecutionService } from "./analyticsExecutionService.js";
import type { AnalyticsQueryService } from "./analyticsQueryService.js";

export class AnalyticsController {
  constructor(
    private readonly analyticsExecutionService: AnalyticsExecutionService,
    private readonly analyticsQueryService: AnalyticsQueryService,
    private readonly analyticsDashboardExportService: AnalyticsDashboardExportService,
    private readonly analyticsDashboardEventService: AnalyticsDashboardEventService,
    private readonly analyticsDashboardPreferenceService: AnalyticsDashboardPreferenceService,
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

  async updateProjectDashboardPreference(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardPreferenceSchema.parse(request.body);
    const response =
      await this.analyticsDashboardPreferenceService.updateProjectPreference(
        auth.userId,
        params.projectId!,
        body,
      );
    return successResponse(response);
  }

  async resetProjectDashboardPreference(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    await this.analyticsDashboardPreferenceService.resetProjectPreference(
      auth.userId,
      params.projectId!,
    );
    return successResponse({ success: true });
  }

  async trackProjectDashboardInteraction(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardInteractionSchema.parse(request.body);
    await this.analyticsDashboardEventService.trackProjectInteraction(
      auth.userId,
      params.projectId!,
      body,
    );
    return successResponse({ success: true });
  }

  async downloadProjectDashboardExport(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardExportRequestSchema.parse(request.body);
    const response =
      await this.analyticsDashboardExportService.exportProjectDashboard(
        auth.userId,
        params.projectId!,
        body,
      );

    return reply
      .type(response.contentType)
      .header(
        "content-disposition",
        `attachment; filename="${encodeURIComponent(response.fileName)}"`,
      )
      .send(response.content);
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

  async updateActivityDashboardPreference(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardPreferenceSchema.parse(request.body);
    const response =
      await this.analyticsDashboardPreferenceService.updateActivityPreference(
        auth.userId,
        params.projectId!,
        params.activityId!,
        body,
      );
    return successResponse(response);
  }

  async resetActivityDashboardPreference(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    await this.analyticsDashboardPreferenceService.resetActivityPreference(
      auth.userId,
      params.projectId!,
      params.activityId!,
    );
    return successResponse({ success: true });
  }

  async trackActivityDashboardInteraction(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardInteractionSchema.parse(request.body);
    await this.analyticsDashboardEventService.trackActivityInteraction(
      auth.userId,
      params.projectId!,
      params.activityId!,
      body,
    );
    return successResponse({ success: true });
  }

  async downloadActivityDashboardExport(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const body = analyticsDashboardExportRequestSchema.parse(request.body);
    const response =
      await this.analyticsDashboardExportService.exportActivityDashboard(
        auth.userId,
        params.projectId!,
        params.activityId!,
        body,
      );

    return reply
      .type(response.contentType)
      .header(
        "content-disposition",
        `attachment; filename="${encodeURIComponent(response.fileName)}"`,
      )
      .send(response.content);
  }
}
