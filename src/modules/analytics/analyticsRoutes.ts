import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AnalyticsController } from "./analyticsController.js";
import {
  analyticsExportRateLimitConfig,
  analyticsGenerationRateLimitConfig,
} from "../../shared/http/rateLimitConfigs.js";

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  controller: AnalyticsController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/projects/:projectId/analytics/generate",
    {
      preHandler: authenticate,
      config: analyticsGenerationRateLimitConfig,
    },
    controller.generateForProject.bind(controller),
  );

  app.get(
    "/projects/:projectId/analytics",
    { preHandler: authenticate },
    controller.getProjectAnalytics.bind(controller),
  );

  app.put(
    "/projects/:projectId/analytics/layout",
    { preHandler: authenticate },
    controller.updateProjectDashboardPreference.bind(controller),
  );

  app.delete(
    "/projects/:projectId/analytics/layout",
    { preHandler: authenticate },
    controller.resetProjectDashboardPreference.bind(controller),
  );

  app.post(
    "/projects/:projectId/analytics/events",
    { preHandler: authenticate },
    controller.trackProjectDashboardInteraction.bind(controller),
  );

  app.post(
    "/projects/:projectId/analytics/export",
    {
      preHandler: authenticate,
      config: analyticsExportRateLimitConfig,
    },
    controller.downloadProjectDashboardExport.bind(controller),
  );

  app.post(
    "/projects/:projectId/activities/:activityId/analytics/generate",
    {
      preHandler: authenticate,
      config: analyticsGenerationRateLimitConfig,
    },
    controller.generateForActivity.bind(controller),
  );

  app.get(
    "/projects/:projectId/activities/:activityId/analytics",
    { preHandler: authenticate },
    controller.getActivityAnalytics.bind(controller),
  );

  app.put(
    "/projects/:projectId/activities/:activityId/analytics/layout",
    { preHandler: authenticate },
    controller.updateActivityDashboardPreference.bind(controller),
  );

  app.delete(
    "/projects/:projectId/activities/:activityId/analytics/layout",
    { preHandler: authenticate },
    controller.resetActivityDashboardPreference.bind(controller),
  );

  app.post(
    "/projects/:projectId/activities/:activityId/analytics/events",
    { preHandler: authenticate },
    controller.trackActivityDashboardInteraction.bind(controller),
  );

  app.post(
    "/projects/:projectId/activities/:activityId/analytics/export",
    {
      preHandler: authenticate,
      config: analyticsExportRateLimitConfig,
    },
    controller.downloadActivityDashboardExport.bind(controller),
  );
}
