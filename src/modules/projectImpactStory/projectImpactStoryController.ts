import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import { ProcessingJobService } from "../ai/execution/processingJobService.js";
import { ProjectImpactStoryService } from "./projectImpactStoryService.js";

export class ProjectImpactStoryController {
  constructor(
    private readonly projectImpactStoryService: ProjectImpactStoryService,
    private readonly processingJobService: ProcessingJobService,
  ) {}

  async triggerImpactStoryRun(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    // The gate check runs synchronously so the caller gets an immediate 4xx
    // for a project with nothing groundable yet, instead of a queued job
    // that only fails once claimed — same reasoning as
    // previewActivityAnalysisV2. Only the Python narrative round trip runs
    // inside the job, executed by activityAnalysisWorker.ts.
    const { project } =
      await this.projectImpactStoryService.assertReadyForImpactStoryRun(
        auth.userId,
        params.projectId!,
        language,
      );
    const job = await this.processingJobService.create(
      auth.userId,
      project.id,
      {
        jobType: "project_impact_story",
        payload: { language },
      },
    );
    return successResponse(job);
  }

  async getLatestImpactStory(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response = await this.projectImpactStoryService.getLatestForProject(
      auth.userId,
      params.projectId!,
    );
    return successResponse(response);
  }
}
