import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  approvePrivacyReviewSchema,
  idParamSchema,
} from "../../schemas/httpSchemas.js";
import { PrivacyReviewService } from "./privacyReviewService.js";

export class PrivacyReviewController {
  constructor(private readonly privacyReviewService: PrivacyReviewService) {}

  async getByProcessingJobId(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const review = await this.privacyReviewService.getByProcessingJobId(
      auth.userId,
      params.processingJobId!,
    );
    return successResponse(review);
  }

  async approve(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = approvePrivacyReviewSchema.parse(request.body);
    const response = await this.privacyReviewService.approve(
      auth.userId,
      params.processingJobId!,
      payload.decisions,
    );
    return successResponse(response);
  }
}
