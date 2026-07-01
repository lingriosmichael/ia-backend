import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { successResponse } from "../../shared/http/api-response.js";
import { idParamSchema } from "../../schemas/http-schemas.js";
import { ActivityUploadService } from "./activity-upload.service.js";

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
