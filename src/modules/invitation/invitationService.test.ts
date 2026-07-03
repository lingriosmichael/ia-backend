import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { AppError } from "../../shared/errors/appError.js";
import type { EmailService } from "../../shared/email/emailService.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import type { InvitationRepository } from "./invitationRepository.js";
import { InvitationService } from "./invitationService.js";

test("invitation creation sends an email with the frontend acceptance URL", async () => {
  const sentEmails: Array<{
    toEmail: string;
    organizationName: string;
    acceptUrl: string;
    acceptanceMode: "create_account" | "sign_in";
  }> = [];

  const invitationRepository = {
    findPendingByEmail: async () => null,
    create: async () => ({
      id: "invitation-1",
      organizationId: "organization-1",
      email: "pm@example.org",
      role: "PROJECT_MANAGER" as const,
      token: "token-123",
      status: "pending" as const,
      invitedById: "user-1",
      acceptedById: null,
      acceptedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  } as unknown as InvitationRepository;

  const organizationRepository = {
    findById: async () => ({
      id: "organization-1",
      name: "Impact Atlas Foundation",
    }),
    findMembership: async () => null,
  } as unknown as OrganizationRepository;

  const userRepository = {
    findByEmail: async () => null,
  } as unknown as UserRepository;

  const authorizationService = {
    canManageOrganization: async () => undefined,
  } as unknown as AuthorizationService;

  const transactionManager = {} as TransactionManager;

  const emailService = {
    sendOrganizationInvitation: async (input) => {
      sentEmails.push(input);
    },
  } as EmailService;

  const invitationService = new InvitationService(
    invitationRepository,
    organizationRepository,
    userRepository,
    authorizationService,
    transactionManager,
    emailService,
    "http://localhost:8080/",
  );

  await invitationService.create("user-1", "organization-1", {
    email: "pm@example.org",
    role: "PROJECT_MANAGER",
  });

  assert.deepEqual(sentEmails, [
    {
      toEmail: "pm@example.org",
      organizationName: "Impact Atlas Foundation",
      acceptUrl: "http://localhost:8080/invitations/token-123/accept",
      acceptanceMode: "create_account",
    },
  ]);
});

test("invitation creation revokes the invitation and fails when email delivery fails", async () => {
  const revokedInvitationIds: string[] = [];

  const invitationRepository = {
    findPendingByEmail: async () => null,
    create: async () => ({
      id: "invitation-1",
      organizationId: "organization-1",
      email: "pm@example.org",
      role: "PROJECT_MANAGER" as const,
      token: "token-123",
      status: "pending" as const,
      invitedById: "user-1",
      acceptedById: null,
      acceptedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    revoke: async (invitationId: string) => {
      revokedInvitationIds.push(invitationId);
      return {
        id: invitationId,
        organizationId: "organization-1",
        email: "pm@example.org",
        role: "PROJECT_MANAGER" as const,
        token: "token-123",
        status: "revoked" as const,
        invitedById: "user-1",
        acceptedById: null,
        acceptedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
    },
  } as unknown as InvitationRepository;

  const organizationRepository = {
    findById: async () => ({
      id: "organization-1",
      name: "Impact Atlas Foundation",
    }),
    findMembership: async () => null,
  } as unknown as OrganizationRepository;

  const userRepository = {
    findByEmail: async () => null,
  } as unknown as UserRepository;

  const authorizationService = {
    canManageOrganization: async () => undefined,
  } as unknown as AuthorizationService;

  const transactionManager = {} as TransactionManager;

  const emailService = {
    sendOrganizationInvitation: async () => {
      throw new Error("SMTP unavailable");
    },
  } as EmailService;

  const invitationService = new InvitationService(
    invitationRepository,
    organizationRepository,
    userRepository,
    authorizationService,
    transactionManager,
    emailService,
    "http://localhost:8080",
  );

  await assert.rejects(
    invitationService.create("user-1", "organization-1", {
      email: "pm@example.org",
      role: "PROJECT_MANAGER",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "invitation_delivery_failed");
      return true;
    },
  );

  assert.deepEqual(revokedInvitationIds, ["invitation-1"]);
});
