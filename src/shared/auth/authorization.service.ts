import { databaseSession } from "../database/database-client.js";
import { AppError } from "../errors/app-error.js";
import type { ActivityRepository } from "../../modules/activity/activity.repository.js";
import type { ActivityPersistenceRecord } from "../../modules/activity/activity.persistence.js";
import type { OrganizationMembershipPersistenceRecord } from "../../modules/organization/organization.persistence.js";
import type { OrganizationRepository } from "../../modules/organization/organization.repository.js";
import type { ProjectPersistenceRecord } from "../../modules/project/project.persistence.js";
import type { ProjectRepository } from "../../modules/project/project.repository.js";

interface OrganizationAuthorizationContext {
  membership: OrganizationMembershipPersistenceRecord;
}

interface ProjectAuthorizationContext extends OrganizationAuthorizationContext {
  project: ProjectPersistenceRecord;
}

interface ActivityAuthorizationContext extends ProjectAuthorizationContext {
  activity: ActivityPersistenceRecord;
}

export class AuthorizationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly activityRepository: ActivityRepository,
  ) {}

  async requireOrganizationAdmin(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);
    if (membership.role !== "ORGANIZATION_ADMIN") {
      throw new AppError(
        "Organization admin access is required.",
        403,
        "organization_admin_required",
      );
    }

    return membership;
  }

  async requireProjectManager(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);
    if (membership.role !== "PROJECT_MANAGER") {
      throw new AppError(
        "Project manager access is required.",
        403,
        "project_manager_required",
      );
    }

    return membership;
  }

  async canViewOrganization(userId: string, organizationId: string) {
    return {
      membership: await this.requireMembership(userId, organizationId),
    } satisfies OrganizationAuthorizationContext;
  }

  async canManageOrganization(userId: string, organizationId: string) {
    return {
      membership: await this.requireOrganizationAdmin(userId, organizationId),
    } satisfies OrganizationAuthorizationContext;
  }

  async canCreateProject(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);

    return {
      membership,
    } satisfies OrganizationAuthorizationContext;
  }

  async canViewProject(userId: string, projectId: string) {
    const project = await this.requireProject(projectId);
    const membership = await this.requireMembership(userId, project.organizationId);

    if (
      membership.role === "PROJECT_MANAGER" &&
      project.ownerId !== userId
    ) {
      throw new AppError(
        "You do not have access to this project.",
        403,
        "project_access_denied",
      );
    }

    return {
      membership,
      project,
    } satisfies ProjectAuthorizationContext;
  }

  async canEditProject(userId: string, projectId: string) {
    const context = await this.canViewProject(userId, projectId);
    if (context.project.ownerId !== userId) {
      throw new AppError(
        "You do not have permission to edit this project.",
        403,
        "project_edit_denied",
      );
    }

    return context;
  }

  async canViewActivity(userId: string, activityId: string) {
    const activity = await this.requireActivity(activityId);
    const projectContext = await this.canViewProject(userId, activity.projectId);

    return {
      ...projectContext,
      activity,
    } satisfies ActivityAuthorizationContext;
  }

  async canEditActivity(userId: string, activityId: string) {
    const activity = await this.requireActivity(activityId);
    const projectContext = await this.canEditProject(userId, activity.projectId);

    return {
      ...projectContext,
      activity,
    } satisfies ActivityAuthorizationContext;
  }

  async canUploadToActivity(userId: string, activityId: string) {
    const activity = await this.requireActivity(activityId);
    const projectContext = await this.canEditProject(userId, activity.projectId);

    return {
      ...projectContext,
      activity,
    } satisfies ActivityAuthorizationContext;
  }

  private async requireMembership(userId: string, organizationId: string) {
    const membership = await this.organizationRepository.findMembership(
      userId,
      organizationId,
      databaseSession,
    );

    if (!membership) {
      throw new AppError(
        "You do not have access to this organization.",
        403,
        "organization_access_denied",
      );
    }

    return membership;
  }

  private async requireProject(projectId: string) {
    const project = await this.projectRepository.findById(projectId, databaseSession);
    if (!project) {
      throw new AppError("Project not found.", 404, "project_not_found");
    }

    return project;
  }

  private async requireActivity(activityId: string) {
    const activity = await this.activityRepository.findById(activityId, databaseSession);
    if (!activity) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }

    return activity;
  }
}
