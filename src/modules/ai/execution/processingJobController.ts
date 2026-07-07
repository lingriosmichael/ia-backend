import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../../shared/http/apiResponse.js";
import { idParamSchema } from "../../../schemas/httpSchemas.js";
import { ProcessingJobService } from "./processingJobService.js";

export class ProcessingJobController {
  constructor(private readonly processingJobService: ProcessingJobService) {}

  async listByActivity(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const jobs = await this.processingJobService.listByActivity(
      auth.userId,
      params.activityId!,
    );
    return successResponse(jobs);
  }

  async getById(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.getById(
      auth.userId,
      params.processingJobId!,
    );
    return successResponse(job);
  }

  async sync(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.sync(
      auth.userId,
      params.processingJobId!,
    );
    return successResponse(job);
  }

  async cancel(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.cancel(
      auth.userId,
      params.processingJobId!,
    );
    return successResponse(job);
  }
}
