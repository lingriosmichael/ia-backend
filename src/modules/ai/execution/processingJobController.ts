import type { FastifyRequest } from "fastify";
import { AppError } from "../../../shared/errors/appError.js";
import { successResponse } from "../../../shared/http/apiResponse.js";
import {
  idParamSchema,
  updateProcessingJobSchema,
} from "../../../schemas/httpSchemas.js";
import { ProcessingJobService } from "./processingJobService.js";

export class ProcessingJobController {
  constructor(private readonly processingJobService: ProcessingJobService) {}

  async listByActivity(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const jobs = await this.processingJobService.listByActivity(
      request.auth.userId,
      params.activityId!,
    );
    return successResponse(jobs);
  }

  async getById(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.getById(
      request.auth.userId,
      params.processingJobId!,
    );
    return successResponse(job);
  }

  async sync(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.sync(
      request.auth.userId,
      params.processingJobId!,
    );
    return successResponse(job);
  }

  async update(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = updateProcessingJobSchema.parse(request.body);
    const job = await this.processingJobService.update(
      request.auth.userId,
      params.processingJobId!,
      payload,
    );
    return successResponse(job);
  }
}
