import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  approveQualitativeCodingReviewSchema,
  idParamSchema,
} from "../../schemas/httpSchemas.js";
import { ProcessingJobService } from "../ai/execution/processingJobService.js";
import { QualitativeCodingReviewService } from "./qualitativeCodingReviewService.js";

export class QualitativeCodingReviewController {
  constructor(
    private readonly qualitativeCodingReviewService: QualitativeCodingReviewService,
    private readonly processingJobService: ProcessingJobService,
  ) {}

  async getByUploadMetadataId(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const review =
      await this.qualitativeCodingReviewService.getByUploadMetadataId(
        auth.userId,
        params.uploadMetadataId!,
      );
    return successResponse(review);
  }

  async generate(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    // Synchronous pre-flight gate (upload/privacy-safe-representation/
    // interpretation-result existence) so the caller gets an immediate 4xx
    // instead of a queued job that only fails once claimed. The actual
    // LLM-round-trip proposal call runs inside the job, executed by
    // activityAnalysisWorker.ts.
    const { upload } =
      await this.qualitativeCodingReviewService.assertReadyToGenerate(
        auth.userId,
        params.uploadMetadataId!,
      );
    const job = await this.processingJobService.create(
      auth.userId,
      upload.projectId,
      {
        uploadMetadataId: params.uploadMetadataId!,
        jobType: "qualitative_coding_review",
        payload: { language },
      },
    );
    return successResponse(job);
  }

  async approve(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const payload = approveQualitativeCodingReviewSchema.parse(request.body);
    const response = await this.qualitativeCodingReviewService.approve(
      auth.userId,
      params.uploadMetadataId!,
      payload.decisions,
    );
    return successResponse(response);
  }
}
