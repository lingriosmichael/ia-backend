import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { successResponse } from "../../shared/http/api-response.js";
import {
  createUploadMetadataSchema,
  idParamSchema,
  updateUploadMetadataSchema,
} from "../../schemas/http-schemas.js";
import { UploadMetadataService } from "./upload-metadata.service.js";

export class UploadMetadataController {
  constructor(private readonly uploadMetadataService: UploadMetadataService) {}

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

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createUploadMetadataSchema.parse(request.body);
    const record = await this.uploadMetadataService.create(
      request.auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(record);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = updateUploadMetadataSchema.parse(request.body);
    const record = await this.uploadMetadataService.update(
      request.auth.userId,
      params.uploadMetadataId!,
      payload,
    );
    return successResponse(record);
  }
}
