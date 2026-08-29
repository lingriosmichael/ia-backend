import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { processingKickoffRateLimitConfig } from "../../shared/http/rateLimitConfigs.js";
import { OutcomeEvidenceRecommendationController } from "./outcomeEvidenceRecommendationController.js";

// New joint pairing+outcome recommendation flow (OUTCOME_EVIDENCE_MERGE_PLAN.md
// §4.3/§4.4), scoped to one activity rather than a project-level tab like
// the old outcome-evidence-pairing routes.
export async function registerOutcomeEvidenceRecommendationRoutes(
  app: FastifyInstance,
  controller: OutcomeEvidenceRecommendationController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  // Triggers a real LLM call every time (no reconciliation cache exists yet
  // — see the plan's §8 open question) — rate-limited the same way the old
  // flow's "refresh" route is, not treated as a cheap read.
  app.post(
    "/projects/:projectId/activities/:activityId/outcome-evidence-recommendations",
    {
      preHandler: authenticate,
      config: processingKickoffRateLimitConfig,
    },
    controller.recommend.bind(controller),
  );

  app.post(
    "/projects/:projectId/activities/:activityId/outcome-evidence-recommendations/approve",
    { preHandler: authenticate },
    controller.approve.bind(controller),
  );

  // Cheap DB reads (no LLM call), unlike POST .../outcome-evidence-recommendations
  // above — no rate-limit config needed.
  app.get(
    "/projects/:projectId/activities/:activityId/outcome-evidence-links",
    { preHandler: authenticate },
    controller.listConfirmedLinks.bind(controller),
  );

  app.get(
    "/projects/:projectId/activities/:activityId/outcome-evidence-candidates",
    { preHandler: authenticate },
    controller.listCandidates.bind(controller),
  );

  // Same route shape the old, now-removed outcomeEvidencePairingRoutes.ts
  // used for this — un-confirming a link is independent of which review
  // flow produced it.
  app.delete(
    "/projects/:projectId/outcome-evidence-links/:linkId",
    { preHandler: authenticate },
    controller.removeConfirmedLink.bind(controller),
  );

  // Bulk counterpart to the single-link delete above — clears every
  // confirmed link for one activity in one call, backing the panel's
  // "Alle entfernen" action.
  app.delete(
    "/projects/:projectId/activities/:activityId/outcome-evidence-links",
    { preHandler: authenticate },
    controller.removeAllConfirmedLinks.bind(controller),
  );
}
