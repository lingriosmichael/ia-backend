import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  idParamSchema,
  outcomeEvidencePairingProposalDecisionSchema,
} from "../../schemas/httpSchemas.js";
import { OutcomeEvidencePairingService } from "./outcomeEvidencePairingService.js";

export class OutcomeEvidencePairingController {
  constructor(
    private readonly outcomeEvidencePairingService: OutcomeEvidencePairingService,
  ) {}

  async propose(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const result = await this.outcomeEvidencePairingService.proposeForProject(
      auth.userId,
      params.projectId!,
      language,
    );
    return successResponse(result);
  }

  async refresh(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const result = await this.outcomeEvidencePairingService.refreshForProject(
      auth.userId,
      params.projectId!,
      language,
    );
    return successResponse(result);
  }

  async decide(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const payload = outcomeEvidencePairingProposalDecisionSchema.parse(
      request.body,
    );
    const result = await this.outcomeEvidencePairingService.decideProposal(
      auth.userId,
      params.projectId!,
      payload.proposalId,
      payload.decision,
      payload.outcomeId ?? null,
      language,
    );
    return successResponse(result);
  }

  async removeConfirmedLink(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const result = await this.outcomeEvidencePairingService.removeConfirmedLink(
      auth.userId,
      params.projectId!,
      params.linkId!,
      language,
    );
    return successResponse(result);
  }
}
