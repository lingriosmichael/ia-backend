import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import {
  answerInterpretationQuestionSchema,
  idParamSchema,
  setIndicatorStatusSchema,
  setQualitativeCurationStatusSchema,
  startInterpretationSchema,
} from "../../schemas/httpSchemas.js";
import { InterpretationService } from "./interpretationService.js";

function resolveRequestLanguage(
  acceptLanguageHeader: string | string[] | undefined,
): "de" | "en" {
  const value = Array.isArray(acceptLanguageHeader)
    ? acceptLanguageHeader.join(",")
    : (acceptLanguageHeader ?? "");
  return value.toLowerCase().includes("de") ? "de" : "en";
}

export class InterpretationController {
  constructor(private readonly interpretationService: InterpretationService) {}

  async start(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = startInterpretationSchema.parse(request.body ?? {});
    const response = await this.interpretationService.startInterpretation(
      auth.userId,
      params.evidenceId!,
      payload.language,
    );
    return successResponse(response);
  }

  async getByProject(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getByProject(
      auth.userId,
      params.projectId!,
    );
    return successResponse(response);
  }

  async getProjectAiKnowledge(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getProjectAiKnowledge(
      auth.userId,
      params.projectId!,
      resolveRequestLanguage(request.headers["accept-language"]),
    );
    return successResponse(response);
  }

  async startForActivity(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = startInterpretationSchema.parse(request.body ?? {});
    const response =
      await this.interpretationService.startActivityInterpretation(
        auth.userId,
        params.activityId!,
        payload.language,
      );
    return successResponse(response);
  }

  async getActivityAiKnowledge(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getActivityAiKnowledge(
      auth.userId,
      params.activityId!,
    );
    return successResponse(response);
  }

  async generateActivityAiKnowledge(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response =
      await this.interpretationService.generateActivityAiKnowledge(
        auth.userId,
        params.activityId!,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }

  async getById(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getById(
      auth.userId,
      params.interpretationResultId!,
    );
    return successResponse(response);
  }

  async answerQuestion(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = answerInterpretationQuestionSchema.parse(request.body);
    const response = await this.interpretationService.answerQuestion(
      auth.userId,
      params.interpretationResultId!,
      params.questionId!,
      payload.answeredValue,
    );
    return successResponse(response);
  }

  async setIndicatorStatus(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = setIndicatorStatusSchema.parse(request.body);
    const response = await this.interpretationService.setIndicatorStatus(
      auth.userId,
      params.interpretationResultId!,
      params.indicatorId!,
      payload.status,
    );
    return successResponse(response);
  }

  async setQualitativeFindingStatus(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = setQualitativeCurationStatusSchema.parse(request.body);
    const response =
      await this.interpretationService.setQualitativeFindingStatus(
        auth.userId,
        params.interpretationResultId!,
        params.qualitativeFindingId!,
        payload.status,
      );
    return successResponse(response);
  }

  async acknowledgeReview(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.acknowledgeReview(
      auth.userId,
      params.activityId!,
    );
    return successResponse(response);
  }
}
