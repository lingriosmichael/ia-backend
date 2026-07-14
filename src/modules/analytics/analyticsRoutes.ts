import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AnalyticsController } from "./analyticsController.js";

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  controller: AnalyticsController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/projects/:projectId/analytics/generate",
    { preHandler: authenticate },
    controller.generateForProject.bind(controller),
  );

  app.get(
    "/projects/:projectId/analytics",
    { preHandler: authenticate },
    controller.getProjectAnalytics.bind(controller),
  );

  app.post(
    "/projects/:projectId/activities/:activityId/analytics/generate",
    { preHandler: authenticate },
    controller.generateForActivity.bind(controller),
  );

  app.get(
    "/projects/:projectId/activities/:activityId/analytics",
    { preHandler: authenticate },
    controller.getActivityAnalytics.bind(controller),
  );
}
