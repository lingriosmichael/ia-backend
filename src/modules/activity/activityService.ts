import { databaseSession } from "../../shared/database/databaseClient.js";
import type { ResultRepository } from "../ai/artifact/resultRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import { mapActivity } from "../../shared/utils/mappers.js";
import type { ActivityRepository } from "./activityRepository.js";

export class ActivityService {
  constructor(
    private readonly activityRepository: ActivityRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly resultRepository: ResultRepository,
    private readonly processingResourceCleanupService: ProcessingResourceCleanupService,
  ) {}

  async listForProject(userId: string, projectId: string) {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
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
      successIndicators?: string;
      targetAudience?: string;
      additionalContext?: string;
      status?: "active" | "completed";
    },
  ) {
    await this.authorizationService.canEditProject(userId, projectId);

    const activity = await this.activityRepository.create(
      {
        projectId,
        createdById: userId,
        name: input.name.trim(),
        description: input.description?.trim() ?? null,
        activityType: input.activityType?.trim() ?? null,
        owner: input.owner?.trim() ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        objectives: input.objectives?.trim() ?? null,
        successIndicators: input.successIndicators?.trim() ?? null,
        targetAudience: input.targetAudience?.trim() ?? null,
        additionalContext: input.additionalContext?.trim() ?? null,
        status: input.status,
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
      successIndicators?: string | null;
      targetAudience?: string | null;
      additionalContext?: string | null;
      status?: "active" | "completed";
    },
  ) {
    const activity = await this.activityRepository.findById(
      activityId,
      databaseSession,
    );

    if (!activity) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }

    const { project } = await this.authorizationService.canEditActivity(
      userId,
      activityId,
    );

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        name: input.name?.trim(),
        description:
          input.description === undefined
            ? undefined
            : (input.description?.trim() ?? null),
        activityType:
          input.activityType === undefined
            ? undefined
            : (input.activityType?.trim() ?? null),
        owner:
          input.owner === undefined ? undefined : (input.owner?.trim() ?? null),
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
          input.objectives === undefined
            ? undefined
            : (input.objectives?.trim() ?? null),
        successIndicators:
          input.successIndicators === undefined
            ? undefined
            : (input.successIndicators?.trim() ?? null),
        targetAudience:
          input.targetAudience === undefined
            ? undefined
            : (input.targetAudience?.trim() ?? null),
        additionalContext:
          input.additionalContext === undefined
            ? undefined
            : (input.additionalContext?.trim() ?? null),
        status: input.status,
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
    const { activity, project } =
      await this.authorizationService.canViewActivity(userId, activityId);

    return mapActivity(
      {
        ...activity,
        projectOwnerId: project.ownerId,
      },
      userId,
    );
  }

  async delete(userId: string, activityId: string) {
    const { activity, project } =
      await this.authorizationService.canEditActivity(userId, activityId);

    const storageKeys =
      await this.uploadMetadataRepository.listStorageKeysByActivity(
        activityId,
        databaseSession,
      );

    await this.resultRepository.deleteByActivity(activityId, databaseSession);
    await this.processingResourceCleanupService.deleteByActivityId(
      activityId,
      databaseSession,
    );
    await this.processingJobRepository.deleteByActivity(
      activityId,
      databaseSession,
    );
    await this.uploadMetadataRepository.deleteByActivity(
      activityId,
      databaseSession,
    );
    await this.activityRepository.deleteById(activityId, databaseSession);
    await this.fileStorageService.deleteStoredFiles(storageKeys);

    return {
      id: activity.id,
      projectId: project.id,
    };
  }
}
