import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  idParamSchema,
  outcomeEvidenceRecommendationApprovalSchema,
} from "../../schemas/httpSchemas.js";
import { requireParam } from "../../shared/http/requireParam.js";
import type { OutcomeEvidenceRecommendationService } from "./outcomeEvidenceRecommendationService.js";
import type { OutcomeEvidenceRecommendationApprovalService } from "./outcomeEvidenceRecommendationApprovalService.js";

// Backs the interpretation-page review surface for the merged "Ausgangslage
// & Wirkungsdaten" activity (OUTCOME_EVIDENCE_MERGE_PLAN.md §4.5,
// outcomeEvidenceRecommendationPanel.tsx).
export class OutcomeEvidenceRecommendationController {
  constructor(
    private readonly outcomeEvidenceRecommendationService: OutcomeEvidenceRecommendationService,
    private readonly outcomeEvidenceRecommendationApprovalService: OutcomeEvidenceRecommendationApprovalService,
  ) {}

  async recommend(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const result =
      await this.outcomeEvidenceRecommendationService.recommendForProject(
        auth.userId,
        requireParam(params, "projectId"),
        requireParam(params, "activityId"),
        language,
      );
    return successResponse({ recommendations: result });
  }

  async approve(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const payload = outcomeEvidenceRecommendationApprovalSchema.parse(
      request.body,
    );
    const result =
      await this.outcomeEvidenceRecommendationApprovalService.approveRecommendation(
        auth.userId,
        requireParam(params, "projectId"),
        requireParam(params, "activityId"),
        payload,
      );
    return successResponse(result);
  }

  async listConfirmedLinks(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const result =
      await this.outcomeEvidenceRecommendationService.listConfirmedLinksForActivity(
        auth.userId,
        requireParam(params, "projectId"),
        requireParam(params, "activityId"),
      );
    return successResponse({ links: result });
  }

  async listCandidates(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const result =
      await this.outcomeEvidenceRecommendationService.listCandidatesForActivity(
        auth.userId,
        requireParam(params, "projectId"),
        requireParam(params, "activityId"),
      );
    return successResponse({ candidates: result });
  }

  async removeConfirmedLink(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    await this.outcomeEvidenceRecommendationApprovalService.removeConfirmedLink(
      auth.userId,
      requireParam(params, "projectId"),
      requireParam(params, "linkId"),
    );
    return successResponse({ removed: true });
  }

  async removeAllConfirmedLinks(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const removed =
      await this.outcomeEvidenceRecommendationApprovalService.removeAllConfirmedLinksForActivity(
        auth.userId,
        requireParam(params, "projectId"),
        requireParam(params, "activityId"),
      );
    return successResponse({ removed });
  }
}
