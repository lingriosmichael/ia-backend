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
    "/activities/:activityId/analysis-v2/questions",
    {
      preHandler: authenticate,
      // Same pipeline cost as POST .../analysis-v2 — this route just
      // answers one or more questions before triggering the single replan
      // instead of one replan per answer.
      config: processingKickoffRateLimitConfig,
    },
    controller.answerActivityAnalysisV2Questions.bind(controller),
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
    "/activities/:activityId/linkage-review",
    { preHandler: authenticate },
    controller.getActivityLinkageReview.bind(controller),
  );

  // proposalId is passed in the body, not the URL, because it's a
  // synthesized composite key with no fixed length cap — see the comment
  // on linkageProposalDecisionSchema.
  app.post(
    "/activities/:activityId/linkage-review/decisions",
    { preHandler: authenticate },
    controller.reviewActivityLinkageProposal.bind(controller),
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

  app.patch(
    "/interpretations/:interpretationResultId/questions",
    {
      preHandler: authenticate,
      // Answering questions re-syncs dataset preparation, deterministic
      // analysis, and quantitative synthesis (which calls the Python
      // service) — same cost profile as the single-question route above,
      // just amortized over however many questions are answered in one call.
      config: processingKickoffRateLimitConfig,
    },
    controller.answerQuestions.bind(controller),
  );

  app.post(
    "/activities/:activityId/interpretation-acknowledgment",
    { preHandler: authenticate },
    controller.acknowledgeReview.bind(controller),
  );
}
