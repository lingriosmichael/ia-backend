import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../../shared/http/apiResponse.js";
import {
  idParamSchema,
  processingJobCallbackSchema,
  workerClaimProcessingJobSchema,
  workerHeartbeatSchema,
} from "../../../schemas/httpSchemas.js";
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

  // No requireAuthenticatedUser here — this route is reached only by
  // ia_python_service, gated by requireInternalServiceSecret at the route
  // level instead of a user JWT.
  async claimInternally(request: FastifyRequest) {
    const payload = workerClaimProcessingJobSchema.parse(request.body);
    const claimedJob = await this.processingJobService.claimNextRunnableJob(
      payload.workerId,
      payload.supportedJobTypes,
    );
    return successResponse(claimedJob);
  }

  async heartbeatInternally(request: FastifyRequest) {
    const params = idParamSchema.parse(request.params);
    const payload = workerHeartbeatSchema.parse(request.body);
    const job = await this.processingJobService.renewLease(
      params.processingJobId!,
      payload.workerId,
    );
    return successResponse(job);
  }

  async getSourceFileInternally(request: FastifyRequest, reply: FastifyReply) {
    const params = idParamSchema.parse(request.params);
    const file = await this.processingJobService.getSourceFileForWorker(
      params.processingJobId!,
    );

    return reply
      .type(file.contentType)
      .header(
        "content-disposition",
        `attachment; filename="${encodeURIComponent(file.originalFileName)}"`,
      )
      .send(file.stream);
  }

  async completeExternally(request: FastifyRequest) {
    const params = idParamSchema.parse(request.params);
    const payload = processingJobCallbackSchema.parse(request.body);
    const job = await this.processingJobService.applyExternalCompletion(
      params.processingJobId!,
      payload,
    );
    return successResponse(job);
  }
}
