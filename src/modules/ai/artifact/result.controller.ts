import type { FastifyRequest } from "fastify";
import { AppError } from "../../../shared/errors/app-error.js";
import { successResponse } from "../../../shared/http/api-response.js";
import {
  createResultRecordSchema,
  idParamSchema,
  updateResultRecordSchema,
} from "../../../schemas/http-schemas.js";
import { ResultService } from "./result.service.js";

export class ResultController {
  constructor(private readonly resultService: ResultService) {}

  async listByActivity(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const results = await this.resultService.listByActivity(
      request.auth.userId,
      params.activityId!,
    );
    return successResponse(results);
  }

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createResultRecordSchema.parse(request.body);
    const result = await this.resultService.create(
      request.auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(result);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = updateResultRecordSchema.parse(request.body);
    const result = await this.resultService.update(
      request.auth.userId,
      params.resultRecordId!,
      payload,
    );
    return successResponse(result);
  }
}
