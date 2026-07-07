import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../../shared/http/apiResponse.js";
import {
  createResultRecordSchema,
  idParamSchema,
  updateResultRecordSchema,
} from "../../../schemas/httpSchemas.js";
import { ResultRecordService } from "./resultRecordService.js";

export class ResultController {
  constructor(private readonly resultRecordService: ResultRecordService) {}

  async listByActivity(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const results = await this.resultRecordService.listByActivity(
      auth.userId,
      params.activityId!,
    );
    return successResponse(results);
  }

  async create(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = createResultRecordSchema.parse(request.body);
    const result = await this.resultRecordService.create(
      auth.userId,
      params.projectId!,
      payload,
    );
    return successResponse(result);
  }

  async update(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = updateResultRecordSchema.parse(request.body);
    const result = await this.resultRecordService.update(
      auth.userId,
      params.resultRecordId!,
      payload,
    );
    return successResponse(result);
  }
}
