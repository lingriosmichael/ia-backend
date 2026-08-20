import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";
import { OutcomeEvidencePairingController } from "./outcomeEvidencePairingController.js";

export async function registerOutcomeEvidencePairingRoutes(
  app: FastifyInstance,
  controller: OutcomeEvidencePairingController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  // Recomputes candidates from current evidence and returns the refreshed
  // result — doubles as "read current state," matching how
  // EvidenceLinkageReconciliationService.reconcileForActivity is used
  // elsewhere in this codebase.
  app.post(
    "/projects/:projectId/outcome-evidence-pairing/propose",
    { preHandler: authenticate },
    controller.propose.bind(controller),
  );

  app.post(
    "/projects/:projectId/outcome-evidence-pairing/refresh",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.refresh.bind(controller),
  );

  // proposalId is passed in the body, not the URL — see
  // outcomeEvidencePairingProposalDecisionSchema.
  app.post(
    "/projects/:projectId/outcome-evidence-pairing/decisions",
    { preHandler: authenticate },
    controller.decide.bind(controller),
  );

  app.delete(
    "/projects/:projectId/outcome-evidence-links/:linkId",
    { preHandler: authenticate },
    controller.removeConfirmedLink.bind(controller),
  );
}
