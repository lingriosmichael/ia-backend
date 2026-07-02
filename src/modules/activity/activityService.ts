import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { mapActivity } from "../../shared/utils/mappers.js";
import { ensureUniqueSlug } from "../../shared/utils/slug.js";
import type { ActivityRepository } from "./activityRepository.js";

function mapActivityStatus(status: "planning" | "active" | "completed") {
  return status;
}

export class ActivityService {
  constructor(
    private readonly activityRepository: ActivityRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listForProject(userId: string, projectId: string) {
    const { project } = await this.authorizationService.canViewProject(userId, projectId);
    const activities = await this.activityRepository.listByProject(
      project.id,
      databaseSession,
    );
    return activities.map((activity) =>
      mapActivity(
        {
          ...activity,
          projectOwnerId: project.ownerId,
        },
        userId,
      ),
    );
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      name: string;
      description?: string;
      activityType?: string;
      owner?: string;
      startDate?: string;
      endDate?: string;
      objectives?: string;
      expectedOutcomes?: string;
      successIndicators?: string;
      targetAudience?: string;
      additionalContext?: string;
      beneficiaryGroup?: string;
      status?: "planning" | "active" | "completed";
    },
  ) {
    await this.authorizationService.canEditProject(userId, projectId);

    const slug = await ensureUniqueSlug(input.name, (candidate) =>
      this.activityRepository.slugExists(projectId, candidate, databaseSession),
    );

    const activity = await this.activityRepository.create(
      {
        projectId,
        createdById: userId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() ?? null,
        activityType: input.activityType?.trim() ?? null,
        owner: input.owner?.trim() ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        objectives: input.objectives?.trim() ?? null,
        expectedOutcomes: input.expectedOutcomes?.trim() ?? null,
        successIndicators: input.successIndicators?.trim() ?? null,
        targetAudience: input.targetAudience?.trim() ?? null,
        additionalContext: input.additionalContext?.trim() ?? null,
        beneficiaryGroup: input.beneficiaryGroup?.trim() ?? null,
        status: input.status ? mapActivityStatus(input.status) : undefined,
      },
      databaseSession,
    );

    return mapActivity(
      {
        ...activity,
        projectOwnerId: userId,
      },
      userId,
    );
  }

  async update(
    userId: string,
    activityId: string,
    input: {
      name?: string;
      description?: string | null;
      activityType?: string | null;
      owner?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      objectives?: string | null;
      expectedOutcomes?: string | null;
      successIndicators?: string | null;
      targetAudience?: string | null;
      additionalContext?: string | null;
      beneficiaryGroup?: string | null;
      status?: "planning" | "active" | "completed";
    },
  ) {
    const activity = await this.activityRepository.findById(activityId, databaseSession);

    if (!activity) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }

    const { project } = await this.authorizationService.canEditActivity(userId, activityId);

    let slug: string | undefined;
    if (input.name && input.name.trim() !== activity.name) {
      slug = await ensureUniqueSlug(input.name, async (candidate) => {
        if (candidate === activity.slug) {
          return false;
        }

        return this.activityRepository.slugExists(
          activity.projectId,
          candidate,
          databaseSession,
        );
      });
    }

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        name: input.name?.trim(),
        slug,
        description: input.description === undefined ? undefined : input.description?.trim() ?? null,
        activityType:
          input.activityType === undefined ? undefined : input.activityType?.trim() ?? null,
        owner: input.owner === undefined ? undefined : input.owner?.trim() ?? null,
        startDate:
          input.startDate === undefined
            ? undefined
            : input.startDate
              ? new Date(input.startDate)
              : null,
        endDate:
          input.endDate === undefined
            ? undefined
            : input.endDate
              ? new Date(input.endDate)
              : null,
        objectives:
          input.objectives === undefined ? undefined : input.objectives?.trim() ?? null,
        expectedOutcomes:
          input.expectedOutcomes === undefined
            ? undefined
            : input.expectedOutcomes?.trim() ?? null,
        successIndicators:
          input.successIndicators === undefined
            ? undefined
            : input.successIndicators?.trim() ?? null,
        targetAudience:
          input.targetAudience === undefined
            ? undefined
            : input.targetAudience?.trim() ?? null,
        additionalContext:
          input.additionalContext === undefined
            ? undefined
            : input.additionalContext?.trim() ?? null,
        beneficiaryGroup:
          input.beneficiaryGroup === undefined
            ? undefined
            : input.beneficiaryGroup?.trim() ?? null,
        status: input.status ? mapActivityStatus(input.status) : undefined,
      },
      databaseSession,
    );

    return mapActivity(
      {
        ...updatedActivity,
        projectOwnerId: project.ownerId,
      },
      userId,
    );
  }

  async getById(userId: string, activityId: string) {
    const { activity, project } = await this.authorizationService.canViewActivity(
      userId,
      activityId,
    );

    return mapActivity(
      {
        ...activity,
        projectOwnerId: project.ownerId,
      },
      userId,
    );
  }
}
