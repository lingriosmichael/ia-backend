import type { FastifyRequest } from "fastify";
import { requireAuthenticatedUser } from "../../shared/auth/requireAuthenticatedUser.js";
import { successResponse } from "../../shared/http/apiResponse.js";
import { resolveRequestLanguage } from "../../shared/http/resolveRequestLanguage.js";
import { idParamSchema } from "../../schemas/httpSchemas.js";
import { ProcessingJobService } from "../ai/execution/processingJobService.js";
import { ProjectImpactStoryService } from "./projectImpactStoryService.js";
import { requireParam } from "../../shared/http/requireParam.js";

export class ProjectImpactStoryController {
  constructor(
    private readonly projectImpactStoryService: ProjectImpactStoryService,
    private readonly processingJobService: ProcessingJobService,
  ) {}

  async triggerImpactStoryRun(request: FastifyRequest) {
    return this.triggerProjectAnalyticsRun(request);
  }

  async triggerProjectAnalyticsRun(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const language = resolveRequestLanguage(request.headers["accept-language"]);
    // The gate check runs synchronously so the caller gets an immediate 4xx
    // for a project with nothing groundable yet, instead of a queued job
    // that only fails once claimed — same reasoning as
    // previewActivityAnalysisV2. Only the Python narrative round trip runs
    // inside the job, executed by activityAnalysisWorker.ts.
    const { project } =
      await this.projectImpactStoryService.assertReadyForProjectAnalyticsRun(
        auth.userId,
        requireParam(params, "projectId"),
        language,
      );

    // Idempotent by design: a run can take upwards of ten minutes (real LLM
    // latency, see the grounding retry loop), and the frontend's only
    // record of "a run is in flight" lives in page-local state that a tab
    // switch discards — without this, coming back and clicking the button
    // again (because it looks idle) would kick off a second, wastefully
    // concurrent run against the same project data. Returning the existing
    // job instead of creating a new one means the frontend can safely
    // resume tracking whatever's already running rather than duplicate it.
    // This check-then-create has a small race window (two requests landing
    // before either job commits) — acceptable here since the failure mode
    // is a redundant LLM run, not a correctness or data-integrity problem.
    const existingJob =
      await this.processingJobService.findActiveByProjectAndType(
        auth.userId,
        project.id,
        "project_impact_story",
      );
    if (existingJob) {
      return successResponse(existingJob);
    }

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

  // Lets the frontend discover an already-in-flight run on page mount
  // (see ProjectImpactStoryPage) instead of only ever knowing about a job
  // it personally just created — the counterpart to
  // triggerProjectAnalyticsRun's create-or-return-existing guard above.
  async getActiveProjectAnalyticsRun(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);
    const params = idParamSchema.parse(request.params);
    const job = await this.processingJobService.findActiveByProjectAndType(
      auth.userId,
      requireParam(params, "projectId"),
      "project_impact_story",
    );
    return successResponse({ job });
  }

  async getLatestImpactStory(request: FastifyRequest) {
    return this.getLatestProjectAnalytics(request);
  }

  async getLatestProjectAnalytics(request: FastifyRequest) {
    const auth = requireAuthenticatedUser(request);

    const params = idParamSchema.parse(request.params);
    const response =
      await this.projectImpactStoryService.getLatestProjectAnalytics(
        auth.userId,
        requireParam(params, "projectId"),
      );
    return successResponse(response);
  }
}
