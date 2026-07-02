import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/appError.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import { ActivityUploadService } from "./activityUploadService.js";

export class ActivityUploadController {
  constructor(private readonly activityUploadService: ActivityUploadService) {}

  async upload(request: FastifyRequest) {
    if (!request.auth) {
      throw new AppError("Authentication is required.", 401, "unauthorized");
    }

    const params = idParamSchema.parse(request.params);
    const file = await request.file();
    const response = await this.activityUploadService.uploadForActivity(
      request.auth.userId,
      params.activityId!,
      file,
    );

    return successResponse(response);
  }
}
