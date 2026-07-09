import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InterpretationController } from "./interpretationController.js";

export async function registerInterpretationRoutes(
  app: FastifyInstance,
  controller: InterpretationController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.post(
    "/evidence/:evidenceId/interpret",
    { preHandler: authenticate },
    controller.start.bind(controller),
  );

  app.get(
    "/projects/:projectId/interpretation",
    { preHandler: authenticate },
    controller.getByProject.bind(controller),
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

  app.patch(
    "/interpretations/:interpretationResultId/indicators/:indicatorId",
    { preHandler: authenticate },
    controller.setIndicatorStatus.bind(controller),
  );
}
