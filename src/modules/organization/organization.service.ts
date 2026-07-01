import type { MultipartFile } from "@fastify/multipart";
import { databaseSession } from "../../shared/database/database-client.js";
import type { TransactionManager } from "../../shared/database/transaction-manager.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  mapOrganizationMembership,
  mapWorkspace,
} from "../../shared/utils/mappers.js";
import { ensureUniqueSlug } from "../../shared/utils/slug.js";
import type { ActivityRepository } from "../activity/activity.repository.js";
import type { ResultRepository } from "../ai/artifact/result.repository.js";
import type { ProcessingJobRepository } from "../ai/execution/processing-job.repository.js";
import type { ProjectRepository } from "../project/project.repository.js";
import { FileStorageService } from "../upload/file-storage.service.js";
import type { UploadMetadataRepository } from "../upload/upload-metadata.repository.js";
import type { OrganizationRepository } from "./organization.repository.js";

export class OrganizationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly projectRepository: ProjectRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly resultRepository: ResultRepository,
    private readonly transactionManager: TransactionManager,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.organizationRepository.listForUser(
      userId,
      databaseSession,
    );
    return memberships.map(mapOrganizationMembership);
  }

  async create(userId: string, input: { name: string }) {
    const slug = await ensureUniqueSlug(input.name, (candidate) =>
      this.organizationRepository.slugExists(candidate, databaseSession),
    );

    const organization = await this.transactionManager.runInTransaction(async (session) => {
      const createdOrganization = await this.organizationRepository.create(
        {
          name: input.name.trim(),
          slug,
        },
        session,
      );

      await this.organizationRepository.createMembership(
        {
          userId,
          organizationId: createdOrganization.id,
          role: "owner",
        },
        session,
      );

      return createdOrganization;
    });

    const membership = await this.organizationRepository.findMembership(
      userId,
      organization.id,
      databaseSession,
    );

    if (!membership) {
      throw new AppError("Organization membership was not created.", 500, "membership_missing");
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: membership.role,
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    };
  }

  async update(
    userId: string,
    organizationId: string,
    input: {
      name?: string;
      description?: string | null;
      logoFile?: MultipartFile;
    },
  ) {
    await this.requireMembership(userId, organizationId);

    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );
    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    const normalizedName = input.name?.trim();
    const normalizedDescription =
      input.description === undefined
        ? undefined
        : input.description?.trim()
          ? input.description.trim()
          : null;

    let slug: string | undefined;
    if (normalizedName && normalizedName !== organization.name) {
      slug = await ensureUniqueSlug(normalizedName, async (candidate) => {
        if (candidate === organization.slug) {
          return false;
        }

        return this.organizationRepository.slugExists(candidate, databaseSession);
      });
    }

    let logoPath: string | undefined;
    if (input.logoFile) {
      const storedLogo = await this.fileStorageService.storeOrganizationLogo(
        organizationId,
        input.logoFile,
      );
      logoPath = storedLogo.storageKey;
    }

    const updatedOrganization = await this.organizationRepository.update(
      organizationId,
      {
        name: normalizedName,
        description: normalizedDescription,
        slug,
        logoPath,
      },
      databaseSession,
    );

    const membership = await this.organizationRepository.findMembership(
      userId,
      organizationId,
      databaseSession,
    );

    if (!membership) {
      throw new AppError("Organization membership is missing.", 500, "membership_missing");
    }

    return mapOrganizationMembership({
      role: membership.role,
      organization: updatedOrganization,
    });
  }

  async getWorkspace(userId: string, organizationId: string) {
    const workspace = await this.organizationRepository.findWorkspaceForUser(
      organizationId,
      userId,
      databaseSession,
    );

    if (!workspace) {
      throw new AppError("Organization workspace not found.", 404, "organization_not_found");
    }

    const organizationProjects = await this.projectRepository.listByOrganization(
      organizationId,
      databaseSession,
    );
    const projectActivities = await this.activityRepository.listByProjectIds(
      organizationProjects.map((project) => project.id),
      databaseSession,
    );
    const activityUploadCounts = await this.uploadMetadataRepository.countByActivityIds(
      projectActivities.map((activity) => activity.id),
      databaseSession,
    );
    const activityProcessingJobCounts =
      await this.processingJobRepository.countByActivityIds(
        projectActivities.map((activity) => activity.id),
        databaseSession,
      );
    const activityResultCounts = await this.resultRepository.countByActivityIds(
      projectActivities.map((activity) => activity.id),
      databaseSession,
    );
    const activitiesByProjectId = projectActivities.reduce<
      Record<
        string,
        Array<
          (typeof projectActivities)[number] & {
            _count: {
              uploadMetadata: number;
              processingJobs: number;
              resultRecords: number;
            };
          }
        >
      >
    >((groups, activity) => {
      const enrichedActivity = {
        ...activity,
        _count: {
          uploadMetadata: activityUploadCounts[activity.id] ?? 0,
          processingJobs: activityProcessingJobCounts[activity.id] ?? 0,
          resultRecords: activityResultCounts[activity.id] ?? 0,
        },
      };

      if (!groups[activity.projectId]) {
        groups[activity.projectId] = [];
      }

      groups[activity.projectId]?.push(enrichedActivity);
      return groups;
    }, {});

    return mapWorkspace({
      ...workspace,
      projects: organizationProjects.map((project) => ({
        ...project,
        activities: activitiesByProjectId[project.id] ?? [],
      })),
    });
  }

  async getLogo(organizationId: string) {
    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );

    if (!organization || !organization.logoPath) {
      throw new AppError("Organization logo not found.", 404, "organization_logo_not_found");
    }

    const storedLogo = await this.fileStorageService.readStoredFile(organization.logoPath);

    return {
      buffer: storedLogo.buffer,
      contentType: this.fileStorageService.getContentTypeForPath(organization.logoPath),
    };
  }

  async requireMembership(userId: string, organizationId: string) {
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
}
