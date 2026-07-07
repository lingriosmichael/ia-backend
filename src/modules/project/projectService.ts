import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  mapProjectSummary,
  mapWorkspaceActivity,
} from "../../shared/utils/mappers.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProjectRepository } from "./projectRepository.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type {
  ProjectOverview,
  ProjectRecentActivityItem,
} from "../../shared/contracts.js";

function mapProjectStatus(status: "planning" | "active" | "completed") {
  return status;
}

function toIso(value: Date) {
  return value.toISOString();
}

function trimNullableText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value.trim() || null;
}

function trimRequiredText(value: string) {
  return value.trim();
}

function trimStringArray(values: string[] | undefined) {
  return values?.map((value) => value.trim()).filter(Boolean);
}

export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly fileStorageService: FileStorageService,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly transactionManager: TransactionManager,
    private readonly userRepository: UserRepository,
    private readonly processingResourceCleanupService: ProcessingResourceCleanupService,
  ) {}

  async listForOrganization(userId: string, organizationId: string) {
    const authorizationContext =
      await this.authorizationService.canViewOrganization(
        userId,
        organizationId,
      );
    const projects =
      authorizationContext.membership.role === "ORGANIZATION_ADMIN"
        ? await this.projectRepository.listByOrganization(
            organizationId,
            databaseSession,
          )
        : await this.projectRepository.listByOrganizationForOwner(
            organizationId,
            userId,
            databaseSession,
          );

    const ownerNamesById = await this.getOwnerNamesById(
      projects.map((project) => project.ownerId),
    );
    return projects.map((project) =>
      mapProjectSummary(
        {
          ...project,
          ownerName: ownerNamesById.get(project.ownerId) ?? null,
        },
        userId,
      ),
    );
  }

  async create(
    userId: string,
    organizationId: string,
    input: {
      name: string;
      startMonth: string;
      endMonth: string;
      fundingProgram: string;
      fundingOrganization: string;
      targetGroups: string[];
      areaOfOperation: string;
      partnerships?: string;
      sdgs?: string[];
      impactModel: {
        inputs: string;
        activities: string;
        outputs: string;
        impact: string;
        outcomes: string;
      };
      successIndicators: string;
    },
  ) {
    await this.authorizationService.canCreateProject(userId, organizationId);

    const project = await this.projectRepository.create(
      {
        organizationId,
        ownerId: userId,
        name: trimRequiredText(input.name),
        startMonth: input.startMonth,
        endMonth: input.endMonth,
        fundingProgram: trimRequiredText(input.fundingProgram),
        fundingOrganization: trimRequiredText(input.fundingOrganization),
        targetGroups: trimStringArray(input.targetGroups) ?? [],
        areaOfOperation: trimRequiredText(input.areaOfOperation),
        partnerships: input.partnerships?.trim() ?? null,
        sdgs: input.sdgs ?? [],
        impactModel: {
          inputs: trimRequiredText(input.impactModel.inputs),
          activities: trimRequiredText(input.impactModel.activities),
          outputs: trimRequiredText(input.impactModel.outputs),
          impact: trimRequiredText(input.impactModel.impact),
          outcomes: trimRequiredText(input.impactModel.outcomes),
        },
        successIndicators: trimRequiredText(input.successIndicators),
      },
      databaseSession,
    );

    return mapProjectSummary(
      {
        ...project,
        ownerName: await this.getOwnerName(project.ownerId),
      },
      userId,
    );
  }

  async update(
    userId: string,
    projectId: string,
    input: {
      name?: string;
      startMonth?: string | null;
      endMonth?: string | null;
      fundingProgram?: string | null;
      fundingOrganization?: string | null;
      targetGroups?: string[];
      areaOfOperation?: string | null;
      partnerships?: string | null;
      sdgs?: string[];
      impactModel?: {
        inputs?: string | null;
        activities?: string | null;
        outputs?: string | null;
        impact?: string | null;
        outcomes?: string | null;
      };
      successIndicators?: string | null;
      status?: "planning" | "active" | "completed";
    },
  ) {
    await this.authorizationService.canEditProject(userId, projectId);

    const updatedProject = await this.projectRepository.update(
      projectId,
      {
        name: input.name?.trim(),
        startMonth:
          input.startMonth === undefined ? undefined : input.startMonth,
        endMonth: input.endMonth === undefined ? undefined : input.endMonth,
        fundingProgram: trimNullableText(input.fundingProgram),
        fundingOrganization: trimNullableText(input.fundingOrganization),
        targetGroups: trimStringArray(input.targetGroups),
        areaOfOperation: trimNullableText(input.areaOfOperation),
        partnerships: trimNullableText(input.partnerships),
        sdgs: input.sdgs,
        impactModel: input.impactModel
          ? {
              inputs: trimNullableText(input.impactModel.inputs),
              activities: trimNullableText(input.impactModel.activities),
              outputs: trimNullableText(input.impactModel.outputs),
              impact: trimNullableText(input.impactModel.impact),
              outcomes: trimNullableText(input.impactModel.outcomes),
            }
          : undefined,
        successIndicators: trimNullableText(input.successIndicators),
        status: input.status ? mapProjectStatus(input.status) : undefined,
      },
      databaseSession,
    );

    return mapProjectSummary(
      {
        ...updatedProject,
        ownerName: await this.getOwnerName(updatedProject.ownerId),
      },
      userId,
    );
  }

  async getById(userId: string, projectId: string) {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );
    return mapProjectSummary(
      {
        ...project,
        ownerName: await this.getOwnerName(project.ownerId),
      },
      userId,
    );
  }

  async getOverview(
    userId: string,
    projectId: string,
  ): Promise<ProjectOverview> {
    const { project: overview } =
      await this.authorizationService.canViewProject(userId, projectId);
    const uploadMetadataCount =
      await this.uploadMetadataRepository.countByProject(
        projectId,
        databaseSession,
      );
    const projectActivities = await this.activityRepository.listByProject(
      projectId,
      databaseSession,
    );
    const activityUploadCounts =
      await this.uploadMetadataRepository.countByActivityIds(
        projectActivities.map((activity) => activity.id),
        databaseSession,
      );
    const recentUploads =
      await this.uploadMetadataRepository.listRecentByProject(
        projectId,
        8,
        databaseSession,
      );
    const activityNamesById = Object.fromEntries(
      projectActivities.map((activity) => [activity.id, activity.name]),
    );

    const activities = projectActivities.map((activity) =>
      mapWorkspaceActivity(
        {
          ...activity,
          projectOwnerId: overview.ownerId,
          _count: {
            uploadMetadata: activityUploadCounts[activity.id] ?? 0,
            processingJobs: 0,
            resultRecords: 0,
          },
        },
        userId,
      ),
    );
    const recentActivity = [
      ...projectActivities.map<ProjectRecentActivityItem>((activity) => ({
        id: `activity-${activity.id}`,
        type: "activity_created",
        occurredAt: toIso(activity.createdAt),
        activityId: activity.id,
        activityName: activity.name,
      })),
      ...recentUploads.map<ProjectRecentActivityItem>((upload) => ({
        id: `upload-${upload.id}`,
        type: "dataset_uploaded",
        occurredAt: toIso(upload.createdAt),
        activityId: upload.activityId,
        activityName: upload.activityId
          ? (activityNamesById[upload.activityId] ?? null)
          : null,
        })),
    ]
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime(),
      )
      .slice(0, 8);

    return {
      project: mapProjectSummary(
        {
          ...overview,
          ownerName: await this.getOwnerName(overview.ownerId),
        },
        userId,
      ),
      activities,
      metrics: {
        activityCount: activities.length,
        uploadedDatasetCount: uploadMetadataCount,
        activitiesWithDatasetsCount: activities.filter(
          (activity) => activity.uploadMetadataCount > 0,
        ).length,
        insightCount: 0,
        pendingInsightCount: 0,
        failedJobCount: 0,
        lastUploadAt: recentUploads[0]
          ? toIso(recentUploads[0].createdAt)
          : null,
      },
      recentActivity,
    };
  }

  async delete(
    userId: string,
    projectId: string,
    input: {
      projectName: string;
    },
  ) {
    const existingProject = await this.projectRepository.findDeleteContext(
      projectId,
      databaseSession,
    );

    if (!existingProject) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    await this.authorizationService.canEditProject(userId, projectId);

    if (input.projectName !== existingProject.name) {
      throw new AppError(
        "Project name confirmation does not match.",
        400,
        "project_name_confirmation_mismatch",
      );
    }

    const storageKeys =
      await this.uploadMetadataRepository.listStorageKeysByProject(
        projectId,
        databaseSession,
      );

    const deletedProject = await this.transactionManager.runInTransaction(
      async (session) => {
        const projectInTransaction =
          await this.projectRepository.findDeleteContext(projectId, session);

        if (!projectInTransaction) {
          throw new AppError("Project not found.", 404, "project_not_found");
        }

        if (projectInTransaction.name !== input.projectName) {
          throw new AppError(
            "Project name confirmation does not match.",
            400,
            "project_name_confirmation_mismatch",
          );
        }

        return this.projectRepository.delete(projectId, session);
      },
    );

    try {
      await this.processingResourceCleanupService.deleteByProjectId(
        projectId,
        databaseSession,
      );
    } catch (error) {
      console.error("Failed to delete processing resource records for project.", {
        projectId,
        error,
      });
    }

    try {
      await this.uploadMetadataRepository.deleteByProject(
        projectId,
        databaseSession,
      );
    } catch (error) {
      console.error("Failed to delete upload metadata records for project.", {
        projectId,
        error,
      });
    }

    if (storageKeys.length > 0) {
      // Filesystem deletion cannot participate in the database transaction,
      // so it runs after commit once relational cleanup has succeeded.
      try {
        await this.fileStorageService.deleteStoredFiles(storageKeys);
      } catch (error) {
        console.error("Failed to delete stored project files.", {
          projectId,
          storageKeys,
          error,
        });
      }
    }

    return deletedProject;
  }

  private async getOwnerName(ownerId: string) {
    const owner = await this.userRepository.findById(ownerId, databaseSession);
    return owner?.fullName ?? null;
  }

  private async getOwnerNamesById(ownerIds: string[]) {
    const owners = await this.userRepository.findByIds(
      [...new Set(ownerIds)],
      databaseSession,
    );

    return new Map(owners.map((owner) => [owner.id, owner.fullName] as const));
  }
}
