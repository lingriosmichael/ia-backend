import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  analysisRunListQuerySchema,
  answerInterpretationQuestionSchema,
  idParamSchema,
  startInterpretationSchema,
} from "../../schemas/httpSchemas.js";
import { ActivityAnalysisV2Service } from "./activityAnalysisV2Service.js";
import { InterpretationService } from "./interpretationService.js";

export class InterpretationController {
  constructor(
    private readonly interpretationService: InterpretationService,
    private readonly activityAnalysisV2Service: ActivityAnalysisV2Service,
  ) {}

  private markLegacyAiKnowledgeEndpointDeprecated(
    reply: FastifyReply,
    activityId: string,
  ) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "Thu, 31 Dec 2026 23:59:59 GMT");
    reply.header(
      "Link",
      `</activities/${activityId}/analysis-v2>; rel="successor-version"`,
    );
  }

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

  async getActivityAiKnowledge(request: FastifyRequest, reply: FastifyReply) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    this.markLegacyAiKnowledgeEndpointDeprecated(reply, params.activityId!);
    const response =
      await this.activityAnalysisV2Service.getLegacyActivityAiKnowledge(
        auth.userId,
        params.activityId!,
      );
    return successResponse(response);
  }

  async generateActivityAiKnowledge(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    this.markLegacyAiKnowledgeEndpointDeprecated(reply, params.activityId!);
    const response =
      await this.activityAnalysisV2Service.previewLegacyActivityAiKnowledge(
        auth.userId,
        params.activityId!,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }

  async regenerateActivityAiKnowledge(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    this.markLegacyAiKnowledgeEndpointDeprecated(reply, params.activityId!);
    const response =
      await this.activityAnalysisV2Service.previewLegacyActivityAiKnowledge(
        auth.userId,
        params.activityId!,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }

  async previewActivityAnalysisV2(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response =
      await this.activityAnalysisV2Service.previewActivityAnalysis(
        auth.userId,
        params.activityId!,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }

  async getLatestActivityAnalysisV2(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response =
      await this.activityAnalysisV2Service.getLatestActivityAnalysis(
        auth.userId,
        params.activityId!,
      );
    return successResponse(response);
  }

  async answerActivityAnalysisV2Question(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = answerInterpretationQuestionSchema.parse(request.body);
    const response =
      await this.activityAnalysisV2Service.answerClarificationQuestion(
        auth.userId,
        params.activityId!,
        params.questionId!,
        payload.answeredValue,
        resolveRequestLanguage(request.headers["accept-language"]),
      );
    return successResponse(response);
  }

  async listActivityAnalysisV2Runs(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const query = analysisRunListQuerySchema.parse(request.query ?? {});
    const response = await this.activityAnalysisV2Service.listActivityAnalyses(
      auth.userId,
      params.activityId!,
      query.limit,
    );
    return successResponse(response);
  }

  async listProjectAnalysisV2Runs(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const query = analysisRunListQuerySchema.parse(request.query ?? {});
    const response = await this.activityAnalysisV2Service.listProjectAnalyses(
      auth.userId,
      params.projectId!,
      query.limit,
    );
    return successResponse(response);
  }

  async getActivityWorkflowStage(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getActivityWorkflowStage(
      auth.userId,
      params.activityId!,
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
