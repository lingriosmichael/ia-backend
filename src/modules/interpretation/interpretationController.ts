import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  answerInterpretationQuestionSchema,
  idParamSchema,
  startInterpretationSchema,
} from "../../schemas/httpSchemas.js";
import { InterpretationService } from "./interpretationService.js";

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
