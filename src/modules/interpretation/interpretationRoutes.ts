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

  // Deprecated compatibility endpoint. Canonical activity analysis lives at
  // `/activities/:activityId/analysis-v2`.
  app.get(
    "/activities/:activityId/ai-knowledge",
    { preHandler: authenticate },
    controller.getActivityAiKnowledge.bind(controller),
  );

  // Deprecated compatibility endpoint. Runs V2 and returns the legacy
  // response shape for older clients.
  app.post(
    "/activities/:activityId/ai-knowledge",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.generateActivityAiKnowledge.bind(controller),
  );

  // Deprecated compatibility endpoint. Runs V2 and returns the legacy
  // response shape for older clients.
  app.put(
    "/activities/:activityId/ai-knowledge",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.regenerateActivityAiKnowledge.bind(controller),
  );

  app.post(
    "/activities/:activityId/analysis-v2",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.previewActivityAnalysisV2.bind(controller),
  );

  app.get(
    "/activities/:activityId/analysis-v2",
    { preHandler: authenticate },
    controller.getLatestActivityAnalysisV2.bind(controller),
  );

  app.patch(
    "/activities/:activityId/analysis-v2/questions/:questionId",
    {
      preHandler: authenticate,
      // Answering a clarification question triggers the same
      // previewActivityAnalysis pipeline as POST .../analysis-v2 (plan +
      // deterministic execution), so it needs the same rate limit — this
      // route was previously unguarded despite being equally expensive.
      config: processingKickoffRateLimitConfig,
    },
    controller.answerActivityAnalysisV2Question.bind(controller),
  );

  app.get(
    "/activities/:activityId/analysis-v2/runs",
    { preHandler: authenticate },
    controller.listActivityAnalysisV2Runs.bind(controller),
  );

  app.get(
    "/projects/:projectId/analysis-v2/runs",
    { preHandler: authenticate },
    controller.listProjectAnalysisV2Runs.bind(controller),
  );

  app.get(
    "/activities/:activityId/workflow-stage",
    { preHandler: authenticate },
    controller.getActivityWorkflowStage.bind(controller),
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
