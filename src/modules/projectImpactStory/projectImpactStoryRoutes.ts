import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProjectImpactStoryController } from "./projectImpactStoryController.js";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";

export async function registerProjectImpactStoryRoutes(
  app: FastifyInstance,
  controller: ProjectImpactStoryController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/projects/:projectId/impact-story",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.triggerImpactStoryRun.bind(controller),
  );

  app.get(
    "/projects/:projectId/impact-story",
    { preHandler: authenticate },
    controller.getLatestImpactStory.bind(controller),
  );
}
