import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import { ProjectDerivedStateInvalidationService } from "../analytics/projectDerivedStateInvalidationService.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { clearActivityAiKnowledgeStateIfPresent } from "../interpretation/interpretationReviewState.js";
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
    private readonly transactionManager: TransactionManager,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly processingResourceCleanupService: ProcessingResourceCleanupService,
    private readonly projectDerivedStateInvalidationService: ProjectDerivedStateInvalidationService,
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
    const nextName =
      input.name === undefined ? activity.name : input.name.trim();
    const nextDescription =
      input.description === undefined
        ? activity.description
        : (input.description?.trim() ?? null);
    const nextObjectives =
      input.objectives === undefined
        ? activity.objectives
        : (input.objectives?.trim() ?? null);
    const nextSuccessIndicators =
      input.successIndicators === undefined
        ? activity.successIndicators
        : (input.successIndicators?.trim() ?? null);
    const nextTargetAudience =
      input.targetAudience === undefined
        ? activity.targetAudience
        : (input.targetAudience?.trim() ?? null);
    const nextAdditionalContext =
      input.additionalContext === undefined
        ? activity.additionalContext
        : (input.additionalContext?.trim() ?? null);
    const shouldClearAiKnowledgeState =
      nextName !== activity.name ||
      nextDescription !== activity.description ||
      nextObjectives !== activity.objectives ||
      nextSuccessIndicators !== activity.successIndicators ||
      nextTargetAudience !== activity.targetAudience ||
      nextAdditionalContext !== activity.additionalContext;
    const shouldInvalidateDerivedState = Boolean(
      shouldClearAiKnowledgeState &&
      (activity.interpretationAcknowledgedAt ||
        activity.interpretationAcknowledgedById),
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
        interpretationAcknowledgedAt: shouldClearAiKnowledgeState
          ? null
          : undefined,
        interpretationAcknowledgedById: shouldClearAiKnowledgeState
          ? null
          : undefined,
        aiKnowledgeSnapshot: shouldClearAiKnowledgeState ? null : undefined,
      },
      databaseSession,
    );

    if (shouldInvalidateDerivedState) {
      await this.projectDerivedStateInvalidationService.invalidateProject(
        project.id,
        databaseSession,
      );
    }

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

    const shouldInvalidateDerivedState = Boolean(
      activity.interpretationAcknowledgedAt ||
      activity.interpretationAcknowledgedById,
    );

    await this.transactionManager.runInTransaction(async (session) => {
      if (shouldInvalidateDerivedState) {
        await clearActivityAiKnowledgeStateIfPresent(
          this.activityRepository,
          activityId,
          session,
        );
        await this.projectDerivedStateInvalidationService.invalidateProject(
          project.id,
          session,
        );
      }

      await this.processingResourceCleanupService.deleteByActivityId(
        activityId,
        session,
      );
      await this.processingJobRepository.deleteByActivity(activityId, session);
      await this.uploadMetadataRepository.deleteByActivity(activityId, session);
      await this.activityRepository.deleteById(activityId, session);
    });

    if (storageKeys.length > 0) {
      // Filesystem deletion cannot participate in the database transaction.
      // By this point every database record referencing these files is
      // already gone, so a failure here can only leave unreferenced bytes
      // on disk — not a dangling reference reachable through the API —
      // which is why this step stays best-effort rather than failing the
      // now-already-completed delete.
      try {
        await this.fileStorageService.deleteStoredFiles(storageKeys);
      } catch (error) {
        console.error("Failed to delete stored activity files.", {
          activityId,
          storageKeys,
          error,
        });
      }
    }

    return {
      id: activity.id,
      projectId: project.id,
    };
  }
}
