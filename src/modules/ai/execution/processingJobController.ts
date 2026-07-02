import type { FastifyRequest } from "fastify";
import { AppError } from "../../../shared/errors/appError.js";
import { successResponse } from "../../../shared/http/apiResponse.js";
import {
  createProcessingJobSchema,
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

  async create(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const payload = createProcessingJobSchema.parse(request.body);
    const job = await this.processingJobService.create(
      request.auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(job);
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
