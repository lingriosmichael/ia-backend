import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
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
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const records = await this.uploadMetadataService.listByActivity(
      request.auth.userId,
      params.activityId!,
    );
    return successResponse(records);
  }

  async getFile(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const file = await this.uploadMetadataService.getFile(
      request.auth.userId,
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
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const response = await this.uploadMetadataService.delete(
      request.auth.userId,
      params.evidenceId!,
    );
    return successResponse(response);
  }

  async analyse(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const response = await this.evidenceProcessingService.startEvidenceAnalysis(
      request.auth.userId,
      params.evidenceId!,
    );
    return successResponse(response);
  }
}
