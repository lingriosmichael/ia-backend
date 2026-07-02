import { databaseSession } from "../../shared/database/database-client.js";
import type { TransactionManager } from "../../shared/database/transaction-manager.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  mapProjectSummary,
  mapWorkspaceActivity,
} from "../../shared/utils/mappers.js";
import { ensureUniqueSlug } from "../../shared/utils/slug.js";
import { AuthorizationService } from "../../shared/auth/authorization.service.js";
import type { ProjectRepository } from "./project.repository.js";
import { FileStorageService } from "../upload/file-storage.service.js";
import type { ActivityRepository } from "../activity/activity.repository.js";
import type { UploadMetadataRepository } from "../upload/upload-metadata.repository.js";
import type { ProcessingJobRepository } from "../ai/execution/processing-job.repository.js";
import type { ResultRepository } from "../ai/artifact/result.repository.js";
import type { UserRepository } from "../user/user.repository.js";
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

export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly fileStorageService: FileStorageService,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly resultRepository: ResultRepository,
    private readonly transactionManager: TransactionManager,
    private readonly userRepository: UserRepository,
  ) {}

  async listForOrganization(userId: string, organizationId: string) {
    const authorizationContext = await this.authorizationService.canViewOrganization(
      userId,
      organizationId,
    );
    const projects =
      authorizationContext.membership.role === "ORGANIZATION_ADMIN"
        ? await this.projectRepository.listByOrganization(organizationId, databaseSession)
        : await this.projectRepository.listByOrganizationForOwner(
            organizationId,
            userId,
            databaseSession,
          );

    const ownerNamesById = await this.getOwnerNamesById(projects.map((project) => project.ownerId));
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
      description?: string;
      programGoal?: string;
      startMonth?: string;
      endMonth?: string;
      country?: string;
      regionCity?: string;
      sdgs?: string[];
      targetBeneficiaries?: string[];
      fundingSource?: string;
      status?: "planning" | "active" | "completed";
    },
  ) {
    await this.authorizationService.canCreateProject(userId, organizationId);

    const slug = await ensureUniqueSlug(input.name, (candidate) =>
      this.projectRepository.slugExists(organizationId, candidate, databaseSession),
    );

    const project = await this.projectRepository.create(
      {
        organizationId,
        ownerId: userId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() ?? null,
        programGoal: input.programGoal?.trim() ?? null,
        startMonth: input.startMonth ?? null,
        endMonth: input.endMonth ?? null,
        country: input.country?.trim() ?? null,
        regionCity: input.regionCity?.trim() ?? null,
        sdgs: input.sdgs ?? [],
        targetBeneficiaries: input.targetBeneficiaries ?? [],
        fundingSource: input.fundingSource?.trim() ?? null,
        status: input.status ? mapProjectStatus(input.status) : undefined,
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
      description?: string | null;
      programGoal?: string | null;
      startMonth?: string | null;
      endMonth?: string | null;
      country?: string | null;
      regionCity?: string | null;
      sdgs?: string[];
      targetBeneficiaries?: string[];
      fundingSource?: string | null;
      status?: "planning" | "active" | "completed";
    },
  ) {
    const { project: existingProject } = await this.authorizationService.canEditProject(
      userId,
      projectId,
    );

    let slug: string | undefined;
    if (input.name && input.name.trim() !== existingProject.name) {
      slug = await ensureUniqueSlug(input.name, async (candidate) => {
        if (candidate === existingProject.slug) {
          return false;
        }

        return this.projectRepository.slugExists(
          existingProject.organizationId,
          candidate,
          databaseSession,
        );
      });
    }

    const updatedProject = await this.projectRepository.update(
      projectId,
      {
        name: input.name?.trim(),
        slug,
        description: input.description === undefined ? undefined : input.description?.trim() ?? null,
        programGoal: input.programGoal === undefined ? undefined : input.programGoal?.trim() ?? null,
        startMonth: input.startMonth === undefined ? undefined : input.startMonth,
        endMonth: input.endMonth === undefined ? undefined : input.endMonth,
        country: input.country === undefined ? undefined : input.country?.trim() ?? null,
        regionCity:
          input.regionCity === undefined ? undefined : input.regionCity?.trim() ?? null,
        sdgs: input.sdgs,
        targetBeneficiaries: input.targetBeneficiaries,
        fundingSource:
          input.fundingSource === undefined ? undefined : input.fundingSource?.trim() ?? null,
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
    const { project } = await this.authorizationService.canViewProject(userId, projectId);
    return mapProjectSummary(
      {
        ...project,
        ownerName: await this.getOwnerName(project.ownerId),
      },
      userId,
    );
  }

  async getOverview(userId: string, projectId: string): Promise<ProjectOverview> {
    const { project: overview } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const pendingInsightCount = await this.processingJobRepository.countByProjectStatuses(
      projectId,
      ["queued", "processing"],
      databaseSession,
    );
    const failedJobCount = await this.processingJobRepository.countByProjectStatuses(
      projectId,
      ["failed"],
      databaseSession,
    );
    const insightCount = await this.resultRepository.countByProjectStatuses(
      projectId,
      ["available"],
      databaseSession,
    );
    const uploadMetadataCount = await this.uploadMetadataRepository.countByProject(
      projectId,
      databaseSession,
    );
    const projectActivities = await this.activityRepository.listByProject(
      projectId,
      databaseSession,
    );
    const activityUploadCounts = await this.uploadMetadataRepository.countByActivityIds(
      projectActivities.map((activity) => activity.id),
      databaseSession,
    );
    const recentUploads = await this.uploadMetadataRepository.listRecentByProject(
      projectId,
      8,
      databaseSession,
    );
    const recentProcessingJobs = await this.processingJobRepository.listRecentByProject(
      projectId,
      8,
      databaseSession,
    );
    const activityProcessingJobCounts =
      await this.processingJobRepository.countByActivityIds(
        projectActivities.map((activity) => activity.id),
        databaseSession,
      );
    const recentResultRecords = await this.resultRepository.listRecentByProject(
      projectId,
      8,
      databaseSession,
    );
    const activityResultCounts = await this.resultRepository.countByActivityIds(
      projectActivities.map((activity) => activity.id),
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
            processingJobs: activityProcessingJobCounts[activity.id] ?? 0,
            resultRecords: activityResultCounts[activity.id] ?? 0,
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
          ? activityNamesById[upload.activityId] ?? null
          : null,
      })),
      ...recentProcessingJobs
        .filter(
          (job) =>
            job.status === "completed" ||
            job.status === "failed",
        )
        .map<ProjectRecentActivityItem>((job) => ({
          id: `job-${job.id}`,
          type: job.status === "completed" ? "job_completed" : "job_failed",
          occurredAt: toIso(job.createdAt),
          activityId: job.activityId,
          activityName: job.activityId ? activityNamesById[job.activityId] ?? null : null,
        })),
      ...recentResultRecords
        .filter((result) => result.status === "available")
        .map<ProjectRecentActivityItem>((result) => ({
          id: `result-${result.id}`,
          type: "insight_generated",
          occurredAt: toIso(result.createdAt),
          activityId: result.activityId,
          activityName:
            result.activityId ? activityNamesById[result.activityId] ?? null : null,
        })),
    ]
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
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
        insightCount,
        pendingInsightCount,
        failedJobCount,
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

    const storageKeys = await this.uploadMetadataRepository.listStorageKeysByProject(
      projectId,
      databaseSession,
    );

    const deletedProject = await this.transactionManager.runInTransaction(async (session) => {
      const projectInTransaction = await this.projectRepository.findDeleteContext(
        projectId,
        session,
      );

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
    });

    try {
      await this.uploadMetadataRepository.deleteByProject(projectId, databaseSession);
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
