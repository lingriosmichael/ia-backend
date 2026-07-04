import type { MultipartFile } from "@fastify/multipart";
import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  mapOrganizationMembership,
  mapWorkspace,
} from "../../shared/utils/mappers.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ResultRepository } from "../ai/artifact/resultRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { FileStorageService } from "../upload/fileStorageService.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { OrganizationRepository } from "./organizationRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import {
  createOrganizationSettings,
  resolveOrganizationSettings,
} from "./organizationSettings.js";

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
    private readonly authorizationService: AuthorizationService,
    private readonly userRepository: UserRepository,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.organizationRepository.listForUser(
      userId,
      databaseSession,
    );
    return memberships.map(mapOrganizationMembership);
  }

  async create(userId: string, input: { name: string }) {
    const normalizedName = input.name.trim();

    if (
      await this.organizationRepository.nameExists(
        normalizedName,
        databaseSession,
      )
    ) {
      throw new AppError(
        "An organization with this name already exists.",
        409,
        "organization_name_exists",
      );
    }

    const organization = await this.transactionManager.runInTransaction(
      async (session) => {
        const createdOrganization = await this.organizationRepository.create(
          {
            name: normalizedName,
            mission: null,
            settings: createOrganizationSettings({
              organizationName: normalizedName,
            }),
          },
          session,
        );

        await this.organizationRepository.createMembership(
          {
            userId,
            organizationId: createdOrganization.id,
            role: "ORGANIZATION_ADMIN",
          },
          session,
        );

        return createdOrganization;
      },
    );

    const membership = await this.organizationRepository.findMembership(
      userId,
      organization.id,
      databaseSession,
    );

    if (!membership) {
      throw new AppError(
        "Organization membership was not created.",
        500,
        "membership_missing",
      );
    }

    return mapOrganizationMembership({
      role: membership.role,
      organization,
    });
  }

  async update(
    userId: string,
    organizationId: string,
    input: {
      name?: string;
      mission?: string | null;
      settings?: {
        organizationName?: string;
        legalForm?: string | null;
        foundingYear?: number | null;
        country?: string | null;
        employeeCount?: number | null;
        mission?: string | null;
        activityAreas?: string[];
        targetGroups?: string[];
        operatingRegions?: string[];
        isRecognizedNonProfit?: boolean | null;
        taxExemptionValidFrom?: string | null;
      };
      logoFile?: MultipartFile;
    },
  ) {
    await this.authorizationService.canManageOrganization(
      userId,
      organizationId,
    );

    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );
    if (!organization) {
      throw new AppError(
        "Organization not found.",
        404,
        "organization_not_found",
      );
    }

    const normalizedName =
      input.settings?.organizationName?.trim() || input.name?.trim();
    const normalizedMission = normalizeNullableText(
      input.settings?.mission ?? input.mission,
    );
    const nextSettings = resolveOrganizationSettings({
      name: normalizedName ?? organization.name,
      mission:
        normalizedMission === undefined
          ? organization.mission
          : normalizedMission,
      settings: {
        ...organization.settings,
        ...normalizeOrganizationSettingsInput(input.settings),
        ...(normalizedName ? { organizationName: normalizedName } : {}),
        ...(normalizedMission !== undefined
          ? { mission: normalizedMission }
          : {}),
      },
    });
    const nextName = normalizedName ?? nextSettings.organizationName;
    const nextMission =
      normalizedMission === undefined
        ? nextSettings.mission
        : normalizedMission;

    if (nextName !== organization.name) {
      if (
        await this.organizationRepository.nameExists(
          nextName,
          databaseSession,
          {
            excludeOrganizationId: organizationId,
          },
        )
      ) {
        throw new AppError(
          "An organization with this name already exists.",
          409,
          "organization_name_exists",
        );
      }
    }

    let logoUrl: string | undefined;
    if (input.logoFile) {
      const storedLogo = await this.fileStorageService.storeOrganizationLogo(
        organizationId,
        input.logoFile,
      );
      logoUrl = storedLogo.storageKey;
    }

    const updatedOrganization = await this.organizationRepository.update(
      organizationId,
      {
        name: nextName,
        mission: nextMission,
        settings: nextSettings,
        logoUrl,
      },
      databaseSession,
    );

    const membership = await this.organizationRepository.findMembership(
      userId,
      organizationId,
      databaseSession,
    );

    if (!membership) {
      throw new AppError(
        "Organization membership is missing.",
        500,
        "membership_missing",
      );
    }

    return mapOrganizationMembership({
      role: membership.role,
      organization: updatedOrganization,
    });
  }

  async getWorkspace(userId: string, organizationId: string) {
    const authorizationContext =
      await this.authorizationService.canViewOrganization(
        userId,
        organizationId,
      );
    const workspace = await this.organizationRepository.findWorkspaceForUser(
      organizationId,
      userId,
      databaseSession,
    );
    const organizationMemberships =
      await this.organizationRepository.listMembershipsByOrganization(
        organizationId,
        databaseSession,
      );

    if (!workspace) {
      throw new AppError(
        "Organization workspace not found.",
        404,
        "organization_not_found",
      );
    }

    const organizationProjects =
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
    const ownerUsers = await this.userRepository.findByIds(
      [...new Set(organizationProjects.map((project) => project.ownerId))],
      databaseSession,
    );
    const ownerNamesById = new Map(
      ownerUsers.map((user) => [user.id, user.fullName] as const),
    );
    const projectActivities = await this.activityRepository.listByProjectIds(
      organizationProjects.map((project) => project.id),
      databaseSession,
    );
    const activityUploadCounts =
      await this.uploadMetadataRepository.countByActivityIds(
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
      currentUserId: userId,
      memberCount: organizationMemberships.length,
      ...workspace,
      projects: organizationProjects.map((project) => ({
        ...project,
        ownerName: ownerNamesById.get(project.ownerId) ?? null,
        activities: (activitiesByProjectId[project.id] ?? []).map(
          (activity) => ({
            ...activity,
            projectOwnerId: project.ownerId,
          }),
        ),
      })),
    });
  }

  async listMembers(userId: string, organizationId: string) {
    await this.authorizationService.canManageOrganization(
      userId,
      organizationId,
    );

    const memberships =
      await this.organizationRepository.listMembershipsByOrganization(
        organizationId,
        databaseSession,
      );
    const users = await this.userRepository.findByIds(
      [...new Set(memberships.map((membership) => membership.userId))],
      databaseSession,
    );
    const usersById = new Map(users.map((user) => [user.id, user]));

    return memberships
      .map((membership) => {
        const user = usersById.get(membership.userId);
        if (!user) {
          return null;
        }

        return {
          id: membership.id,
          userId: membership.userId,
          organizationId: membership.organizationId,
          fullName: user.fullName,
          email: user.email,
          role: membership.role,
          createdAt: membership.createdAt.toISOString(),
          updatedAt: membership.updatedAt.toISOString(),
        };
      })
      .filter(Boolean);
  }

  async removeMember(
    userId: string,
    organizationId: string,
    membershipId: string,
  ) {
    await this.authorizationService.canManageOrganization(
      userId,
      organizationId,
    );

    const memberships =
      await this.organizationRepository.listMembershipsByOrganization(
        organizationId,
        databaseSession,
      );
    const membershipToRemove = memberships.find(
      (membership) => membership.id === membershipId,
    );

    if (!membershipToRemove) {
      throw new AppError(
        "Organization member not found.",
        404,
        "organization_member_not_found",
      );
    }

    if (membershipToRemove.role === "ORGANIZATION_ADMIN") {
      const adminCount = memberships.filter(
        (membership) => membership.role === "ORGANIZATION_ADMIN",
      ).length;

      if (adminCount <= 1) {
        throw new AppError(
          "At least one organization admin must remain.",
          409,
          "organization_admin_required",
        );
      }
    }

    await this.organizationRepository.deleteMembership(
      membershipId,
      databaseSession,
    );

    return {
      id: membershipToRemove.id,
      userId: membershipToRemove.userId,
      organizationId: membershipToRemove.organizationId,
      role: membershipToRemove.role,
    };
  }

  async getLogo(organizationId: string) {
    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );

    if (!organization || !organization.logoUrl) {
      throw new AppError(
        "Organization logo not found.",
        404,
        "organization_logo_not_found",
      );
    }

    const storedLogo = await this.fileStorageService.readStoredFile(
      organization.logoUrl,
    );

    return {
      buffer: storedLogo.buffer,
      contentType: this.fileStorageService.getContentTypeForPath(
        organization.logoUrl,
      ),
    };
  }

  async requireMembership(userId: string, organizationId: string) {
    const { membership } = await this.authorizationService.canViewOrganization(
      userId,
      organizationId,
    );
    return membership;
  }
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}

function normalizeOrganizationSettingsInput(
  input:
    | {
        organizationName?: string;
        legalForm?: string | null;
        foundingYear?: number | null;
        country?: string | null;
        employeeCount?: number | null;
        mission?: string | null;
        activityAreas?: string[];
        targetGroups?: string[];
        operatingRegions?: string[];
        isRecognizedNonProfit?: boolean | null;
        taxExemptionValidFrom?: string | null;
      }
    | undefined,
) {
  if (!input) {
    return {};
  }

  return {
    ...(input.organizationName !== undefined
      ? { organizationName: input.organizationName.trim() }
      : {}),
    ...(input.legalForm !== undefined
      ? { legalForm: normalizeNullableText(input.legalForm) }
      : {}),
    ...(input.foundingYear !== undefined
      ? { foundingYear: input.foundingYear }
      : {}),
    ...(input.country !== undefined
      ? { country: normalizeNullableText(input.country) }
      : {}),
    ...(input.employeeCount !== undefined
      ? { employeeCount: input.employeeCount }
      : {}),
    ...(input.mission !== undefined
      ? { mission: normalizeNullableText(input.mission) }
      : {}),
    ...(input.activityAreas !== undefined
      ? { activityAreas: input.activityAreas }
      : {}),
    ...(input.targetGroups !== undefined
      ? { targetGroups: input.targetGroups }
      : {}),
    ...(input.operatingRegions !== undefined
      ? { operatingRegions: input.operatingRegions }
      : {}),
    ...(input.isRecognizedNonProfit !== undefined
      ? { isRecognizedNonProfit: input.isRecognizedNonProfit }
      : {}),
    ...(input.taxExemptionValidFrom !== undefined
      ? {
          taxExemptionValidFrom: normalizeNullableText(
            input.taxExemptionValidFrom,
          ),
        }
      : {}),
  };
}
