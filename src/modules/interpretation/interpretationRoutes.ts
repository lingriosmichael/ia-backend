import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InterpretationController } from "./interpretationController.js";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";

export async function registerInterpretationRoutes(
  app: FastifyInstance,
  controller: InterpretationController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/evidence/:evidenceId/interpret",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.start.bind(controller),
  );

  app.get(
    "/projects/:projectId/interpretation",
    { preHandler: authenticate },
    controller.getByProject.bind(controller),
  );

  app.post(
    "/activities/:activityId/interpret",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.startForActivity.bind(controller),
  );

  app.get(
    "/activities/:activityId/ai-knowledge",
    { preHandler: authenticate },
    controller.getActivityAiKnowledge.bind(controller),
  );

  app.post(
    "/activities/:activityId/ai-knowledge",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.generateActivityAiKnowledge.bind(controller),
  );

  app.get(
    "/interpretations/:interpretationResultId",
    { preHandler: authenticate },
    controller.getById.bind(controller),
  );

  app.patch(
    "/interpretations/:interpretationResultId/questions/:questionId",
    { preHandler: authenticate },
    controller.answerQuestion.bind(controller),
  );

  app.post(
    "/activities/:activityId/interpretation-acknowledgment",
    { preHandler: authenticate },
    controller.acknowledgeReview.bind(controller),
  );
}
