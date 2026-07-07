import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import { EvidenceProcessingService } from "../processing/evidenceProcessingService.js";
import { UploadMetadataService } from "./uploadMetadataService.js";

export class UploadMetadataController {
  constructor(
    private readonly uploadMetadataService: UploadMetadataService,
    private readonly evidenceProcessingService: EvidenceProcessingService,
  ) {}

  async listByActivity(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const records = await this.uploadMetadataService.listByActivity(
      auth.userId,
      params.activityId!,
    );
    return successResponse(records);
  }

  async getFile(request: FastifyRequest, reply: FastifyReply) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const file = await this.uploadMetadataService.getFile(
      auth.userId,
      params.evidenceId!,
    );

    return reply
      .type(file.contentType)
      .header(
        "content-disposition",
        `inline; filename="${encodeURIComponent(file.originalFileName)}"`,
      )
      .send(file.buffer);
  }

  async delete(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.uploadMetadataService.delete(
      auth.userId,
      params.evidenceId!,
    );
    return successResponse(response);
  }

  async analyse(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.evidenceProcessingService.startEvidenceAnalysis(
      auth.userId,
      params.evidenceId!,
    );
    return successResponse(response);
  }
}
