import { randomBytes } from "node:crypto";
import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { AppError } from "../../shared/errors/appError.js";
import { hashPassword } from "../../shared/utils/password.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import type { InvitationPersistenceRecord } from "./invitationPersistence.js";
import type { InvitationRepository } from "./invitationRepository.js";

export class InvitationService {
  constructor(
    private readonly invitationRepository: InvitationRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly userRepository: UserRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly transactionManager: TransactionManager,
  ) {}

  async listForOrganization(userId: string, organizationId: string) {
    await this.authorizationService.canManageOrganization(userId, organizationId);

    const [organization, invitations] = await Promise.all([
      this.organizationRepository.findById(organizationId, databaseSession),
      this.invitationRepository.listByOrganization(organizationId, databaseSession),
    ]);

    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    return Promise.all(
      invitations.map((invitation) =>
        this.mapInvitationSummary(invitation, organization.name),
      ),
    );
  }

  async create(
    userId: string,
    organizationId: string,
    input: {
      email: string;
      role: "PROJECT_MANAGER";
    },
  ) {
    await this.authorizationService.canManageOrganization(userId, organizationId);

    const email = input.email.trim().toLowerCase();
    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );

    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    const existingInvitation = await this.invitationRepository.findPendingByEmail(
      organizationId,
      email,
      databaseSession,
    );

    if (existingInvitation) {
      throw new AppError(
        "A pending invitation already exists for this email address.",
        409,
        "invitation_already_exists",
      );
    }

    const existingUser = await this.userRepository.findByEmail(email, databaseSession);
    if (existingUser) {
      const existingMembership = await this.organizationRepository.findMembership(
        existingUser.id,
        organizationId,
        databaseSession,
      );

      if (existingMembership) {
        throw new AppError(
          "This user is already a member of the organization.",
          409,
          "organization_member_exists",
        );
      }
    }

    const invitation = await this.invitationRepository.create(
      {
        organizationId,
        email,
        role: "PROJECT_MANAGER",
        token: randomBytes(24).toString("hex"),
        invitedById: userId,
      },
      databaseSession,
    );

    return {
      ...invitation,
      organizationName: organization.name,
      acceptanceMode: existingUser ? "sign_in" : "create_account",
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
    };
  }

  async getByToken(token: string) {
    const invitation = await this.requireInvitation(token);
    const organization = await this.organizationRepository.findById(
      invitation.organizationId,
      databaseSession,
    );

    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    return this.mapInvitationSummary(invitation, organization.name);
  }

  async accept(
    token: string,
    input: {
      fullName?: string;
      password?: string;
      authenticatedUserId?: string;
      authenticatedUserEmail?: string;
    },
  ) {
    const invitation = await this.requireInvitation(token);
    const organization = await this.organizationRepository.findById(
      invitation.organizationId,
      databaseSession,
    );

    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    const existingUser = await this.userRepository.findByEmail(
      invitation.email,
      databaseSession,
    );
    const acceptanceMode = existingUser ? "sign_in" : "create_account";

    if (existingUser) {
      const authenticatedEmail = input.authenticatedUserEmail?.trim().toLowerCase();

      if (!input.authenticatedUserId || !authenticatedEmail) {
        throw new AppError(
          "This invitation belongs to an existing account. Sign in with the invited email address to accept it.",
          401,
          "invitation_requires_authentication",
        );
      }

      if (
        input.authenticatedUserId !== existingUser.id ||
        authenticatedEmail !== invitation.email
      ) {
        throw new AppError(
          "You must sign in with the invited email address to accept this invitation.",
          403,
          "invitation_email_mismatch",
        );
      }
    } else if (!input.fullName?.trim() || !input.password) {
      throw new AppError(
        "Full name and password are required to accept this invitation.",
        400,
        "invitation_registration_required",
      );
    }

    const acceptedInvitation = await this.transactionManager.runInTransaction(
      async (session) => {
        const user =
          existingUser ??
          (await this.userRepository.create(
            {
              email: invitation.email,
              fullName: input.fullName!.trim(),
              passwordHash: await hashPassword(input.password!),
            },
            session,
          ));

        const existingMembership = await this.organizationRepository.findMembership(
          user.id,
          invitation.organizationId,
          session,
        );

        if (existingMembership) {
          throw new AppError(
            "This user is already a member of the organization.",
            409,
            "organization_member_exists",
          );
        }

        await this.organizationRepository.createMembership(
          {
            userId: user.id,
            organizationId: invitation.organizationId,
            role: invitation.role,
          },
          session,
        );

        return this.invitationRepository.markAccepted(invitation.id, user.id, session);
      },
    );

    return {
      invitation: {
        ...acceptedInvitation,
        organizationName: organization.name,
        acceptanceMode,
        acceptedAt: acceptedInvitation.acceptedAt?.toISOString() ?? null,
        createdAt: acceptedInvitation.createdAt.toISOString(),
        updatedAt: acceptedInvitation.updatedAt.toISOString(),
      },
      acceptanceMode,
    };
  }

  async revoke(userId: string, organizationId: string, invitationId: string) {
    await this.authorizationService.canManageOrganization(userId, organizationId);
    const invitation = await this.invitationRepository.revoke(invitationId, databaseSession);

    if (!invitation || invitation.organizationId !== organizationId) {
      throw new AppError("Invitation not found.", 404, "invitation_not_found");
    }

    const organization = await this.organizationRepository.findById(
      organizationId,
      databaseSession,
    );

    if (!organization) {
      throw new AppError("Organization not found.", 404, "organization_not_found");
    }

    return this.mapInvitationSummary(invitation, organization.name);
  }

  private async requireInvitation(token: string) {
    const invitation = await this.invitationRepository.findByToken(token, databaseSession);

    if (!invitation) {
      throw new AppError("Invitation not found.", 404, "invitation_not_found");
    }

    if (invitation.status !== "pending") {
      throw new AppError(
        "This invitation is no longer available.",
        409,
        "invitation_unavailable",
      );
    }

    return invitation;
  }

  private async mapInvitationSummary(
    invitation: InvitationPersistenceRecord,
    organizationName: string,
  ) {
    const existingUser = await this.userRepository.findByEmail(
      invitation.email,
      databaseSession,
    );

    return {
      ...invitation,
      organizationName,
      acceptanceMode: existingUser ? "sign_in" : "create_account",
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
    };
  }
}
