import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ReportReadinessCheckController } from "./reportReadinessCheckController.js";

export async function registerReportReadinessCheckRoutes(
  app: FastifyInstance,
  controller: ReportReadinessCheckController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  app.get(
    "/projects/:projectId/report-readiness-check",
    { preHandler: authenticate },
    controller.getReportReadinessCheck.bind(controller),
  );

  app.post(
    "/projects/:projectId/report-readiness-check",
    { preHandler: authenticate },
    controller.generateReportReadinessCheck.bind(controller),
  );
}
