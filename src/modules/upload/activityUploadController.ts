import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import { ActivityUploadService } from "./activityUploadService.js";

export class ActivityUploadController {
  constructor(private readonly activityUploadService: ActivityUploadService) {}

  async upload(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const file = await request.file();
    const response = await this.activityUploadService.uploadForActivity(
      auth.userId,
      params.activityId!,
      file,
    );

    return successResponse(response);
  }
}
