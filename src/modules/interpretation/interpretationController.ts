import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import {
  analysisRunListQuerySchema,
  answerActivityAnalysisV2QuestionsSchema,
  answerInterpretationQuestionSchema,
  answerInterpretationQuestionsSchema,
  idParamSchema,
  linkageProposalDecisionSchema,
  startInterpretationSchema,
} from "../../schemas/httpSchemas.js";
import { ProcessingJobService } from "../ai/execution/processingJobService.js";
import { ActivityAnalysisV2Service } from "./activityAnalysisV2Service.js";
import { InterpretationService } from "./interpretationService.js";

export class InterpretationController {
  constructor(
    private readonly interpretationService: InterpretationService,
    private readonly activityAnalysisV2Service: ActivityAnalysisV2Service,
    private readonly processingJobService: ProcessingJobService,
  ) {}

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

  async previewActivityAnalysisV2(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    // The gate check runs synchronously so the caller gets an immediate 4xx
    // for a not-ready activity instead of a queued job that only fails once
    // claimed. Only the actual LLM-round-trip work (plan/execute/narrate)
    // runs inside the job, executed by activityAnalysisWorker.ts.
    const { project } =
      await this.activityAnalysisV2Service.assertReadyForV2Run(
        auth.userId,
        params.activityId!,
      );
    const job = await this.processingJobService.create(
      auth.userId,
      project.id,
      {
        activityId: params.activityId!,
        jobType: "activity_analysis_v2",
        payload: {
          language,
          stage: "activity_analysis_v2_pipeline",
        },
      },
    );
    return successResponse(job);
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

  async answerActivityAnalysisV2Questions(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = answerActivityAnalysisV2QuestionsSchema.parse(request.body);
    await this.activityAnalysisV2Service.answerClarificationQuestions(
      auth.userId,
      params.activityId!,
      payload.answers,
    );
    const job = await this.createActivityAnalysisV2ReplanJob(
      request,
      auth.userId,
      params.activityId!,
    );
    return successResponse(job);
  }

  private async createActivityAnalysisV2ReplanJob(
    request: FastifyRequest,
    userId: string,
    activityId: string,
  ) {
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    const { project } =
      await this.activityAnalysisV2Service.assertReadyForV2Run(
        userId,
        activityId,
      );
    return this.processingJobService.create(userId, project.id, {
      activityId,
      jobType: "activity_analysis_v2",
      payload: {
        language,
        stage: "activity_analysis_v2_pipeline",
      },
    });
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

  async getActivityLinkageReview(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.interpretationService.getActivityLinkageReview(
      auth.userId,
      params.activityId!,
    );
    return successResponse(response);
  }

  async reviewActivityLinkageProposal(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = linkageProposalDecisionSchema.parse(request.body);
    const response =
      await this.interpretationService.reviewActivityLinkageProposal(
        auth.userId,
        params.activityId!,
        payload.proposalId,
        payload.decision,
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

  async answerQuestions(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const payload = answerInterpretationQuestionsSchema.parse(request.body);
    const response = await this.interpretationService.answerQuestions(
      auth.userId,
      params.interpretationResultId!,
      payload.answers,
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
