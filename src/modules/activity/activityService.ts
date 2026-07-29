import type { FastifyBaseLogger } from "fastify";
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
import { trimNullableText, trimRequiredText } from "../../shared/utils/text.js";
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
    private readonly logger: FastifyBaseLogger,
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
      startDate?: string;
      endDate?: string;
      targetAudience?: string;
      objectives?: string;
      output?: string;
      outcome?: string;
      status?: "active" | "completed";
    },
  ) {
    await this.authorizationService.canEditProject(userId, projectId);

    const activity = await this.activityRepository.create(
      {
        projectId,
        createdById: userId,
        name: trimRequiredText(input.name),
        description: trimNullableText(input.description) ?? null,
        activityType: trimNullableText(input.activityType) ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        targetAudience: trimNullableText(input.targetAudience) ?? null,
        objectives: trimNullableText(input.objectives) ?? null,
        output: trimNullableText(input.output) ?? null,
        outcome: trimNullableText(input.outcome) ?? null,
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
      startDate?: string | null;
      endDate?: string | null;
      targetAudience?: string | null;
      objectives?: string | null;
      output?: string | null;
      outcome?: string | null;
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
      input.name === undefined ? activity.name : trimRequiredText(input.name);
    const nextDescription =
      input.description === undefined
        ? activity.description
        : (trimNullableText(input.description) ?? null);
    const nextActivityType =
      input.activityType === undefined
        ? activity.activityType
        : (trimNullableText(input.activityType) ?? null);
    const nextTargetAudience =
      input.targetAudience === undefined
        ? activity.targetAudience
        : (trimNullableText(input.targetAudience) ?? null);
    const nextObjectives =
      input.objectives === undefined
        ? activity.objectives
        : (trimNullableText(input.objectives) ?? null);
    const nextOutput =
      input.output === undefined
        ? activity.output
        : (trimNullableText(input.output) ?? null);
    const nextOutcome =
      input.outcome === undefined
        ? activity.outcome
        : (trimNullableText(input.outcome) ?? null);
    const shouldClearAiKnowledgeState =
      nextName !== activity.name ||
      nextDescription !== activity.description ||
      nextActivityType !== activity.activityType ||
      nextTargetAudience !== activity.targetAudience ||
      nextObjectives !== activity.objectives ||
      nextOutput !== activity.output ||
      nextOutcome !== activity.outcome;
    const shouldInvalidateDerivedState = Boolean(
      shouldClearAiKnowledgeState &&
      (activity.interpretationAcknowledgedAt ||
        activity.interpretationAcknowledgedById),
    );

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        name:
          input.name === undefined ? undefined : trimRequiredText(input.name),
        description: trimNullableText(input.description),
        activityType: trimNullableText(input.activityType),
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
        targetAudience: trimNullableText(input.targetAudience),
        objectives: trimNullableText(input.objectives),
        output: trimNullableText(input.output),
        outcome: trimNullableText(input.outcome),
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
        this.logger.error(
          { activityId, storageKeys, error },
          "Failed to delete stored activity files.",
        );
      }
    }

    return {
      id: activity.id,
      projectId: project.id,
    };
  }
}
