import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import type { ReportReadinessCheckService } from "./reportReadinessCheckService.js";

export class ReportReadinessCheckController {
  constructor(
    private readonly reportReadinessCheckService: ReportReadinessCheckService,
  ) {}

  async getReportReadinessCheck(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const response =
      await this.reportReadinessCheckService.getReportReadinessCheck(
        auth.userId,
        params.projectId!,
      );
    return successResponse(response);
  }

  async generateReportReadinessCheck(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const response =
      await this.reportReadinessCheckService.generateReportReadinessCheck(
        auth.userId,
        params.projectId!,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }
}
