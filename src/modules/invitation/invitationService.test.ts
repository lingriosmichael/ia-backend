import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import type { EmailService } from "../../shared/email/emailService.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { UserRepository } from "../user/userRepository.js";
import type { InvitationRepository } from "./invitationRepository.js";
import { InvitationService } from "./invitationService.js";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as import("fastify").FastifyBaseLogger;

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
      name: "brindl Foundation",
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
    logger,
  );

  await invitationService.create("user-1", "organization-1", {
    email: "pm@example.org",
    role: "PROJECT_MANAGER",
  });

  assert.deepEqual(sentEmails, [
    {
      toEmail: "pm@example.org",
      organizationName: "brindl Foundation",
      acceptUrl: "http://localhost:8080/invitations/token-123/accept",
      acceptanceMode: "create_account",
    },
  ]);
});

test("invitation creation still succeeds when email delivery fails", async () => {
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
      name: "brindl Foundation",
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
    logger,
  );

  const invitation = await invitationService.create(
    "user-1",
    "organization-1",
    {
      email: "pm@example.org",
      role: "PROJECT_MANAGER",
    },
  );

  assert.equal(invitation.id, "invitation-1");
  assert.equal(invitation.status, "pending");
  assert.deepEqual(revokedInvitationIds, []);
});

test("invitation resend sends the existing acceptance link again", async () => {
  const sentEmails: Array<{
    toEmail: string;
    organizationName: string;
    acceptUrl: string;
    acceptanceMode: "create_account" | "sign_in";
  }> = [];

  const invitationRepository = {
    findById: async () => ({
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
      name: "brindl Foundation",
    }),
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
    logger,
  );

  await invitationService.resend("user-1", "organization-1", "invitation-1");

  assert.deepEqual(sentEmails, [
    {
      toEmail: "pm@example.org",
      organizationName: "brindl Foundation",
      acceptUrl: "http://localhost:8080/invitations/token-123/accept",
      acceptanceMode: "create_account",
    },
  ]);
});

test("invitation revoke marks a pending invitation revoked", async () => {
  const revokedInvitationIds: string[] = [];

  const invitationRepository = {
    findById: async () => ({
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
      name: "brindl Foundation",
    }),
  } as unknown as OrganizationRepository;

  const authorizationService = {
    canManageOrganization: async () => undefined,
  } as unknown as AuthorizationService;

  const invitationService = new InvitationService(
    invitationRepository,
    organizationRepository,
    { findByEmail: async () => null } as unknown as UserRepository,
    authorizationService,
    {} as TransactionManager,
    {} as EmailService,
    "http://localhost:8080/",
    logger,
  );

  const revoked = await invitationService.revoke(
    "user-1",
    "organization-1",
    "invitation-1",
  );

  assert.equal(revoked.status, "revoked");
  assert.deepEqual(revokedInvitationIds, ["invitation-1"]);
});

test("invitation revoke rejects an already-accepted invitation instead of overwriting its status", async () => {
  // Regression test: revoke() used to skip the pending-status guard
  // resend() has, so an admin revoking an already-accepted invitation would
  // flip it to "revoked" while the membership it created stayed fully
  // active — a misleading record with no error and no test. See
  // invitationService.ts's revoke().
  let revokeCalled = false;

  const invitationRepository = {
    findById: async () => ({
      id: "invitation-1",
      organizationId: "organization-1",
      email: "pm@example.org",
      role: "PROJECT_MANAGER" as const,
      token: "token-123",
      status: "accepted" as const,
      invitedById: "user-1",
      acceptedById: "user-2",
      acceptedAt: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    revoke: async () => {
      revokeCalled = true;
      throw new Error(
        "revoke() must not be called for a non-pending invitation",
      );
    },
  } as unknown as InvitationRepository;

  const authorizationService = {
    canManageOrganization: async () => undefined,
  } as unknown as AuthorizationService;

  const invitationService = new InvitationService(
    invitationRepository,
    {} as OrganizationRepository,
    {} as UserRepository,
    authorizationService,
    {} as TransactionManager,
    {} as EmailService,
    "http://localhost:8080/",
    logger,
  );

  await assert.rejects(
    invitationService.revoke("user-1", "organization-1", "invitation-1"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "invitation_unavailable");
      return true;
    },
  );
  assert.equal(revokeCalled, false);
});

test("invitation revoke 404s for an invitation belonging to a different organization, without writing to it", async () => {
  let revokeCalled = false;

  const invitationRepository = {
    findById: async () => ({
      id: "invitation-1",
      organizationId: "organization-2",
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
    revoke: async () => {
      revokeCalled = true;
      throw new Error(
        "revoke() must not be called for an invitation outside the caller's organization",
      );
    },
  } as unknown as InvitationRepository;

  const authorizationService = {
    canManageOrganization: async () => undefined,
  } as unknown as AuthorizationService;

  const invitationService = new InvitationService(
    invitationRepository,
    {} as OrganizationRepository,
    {} as UserRepository,
    authorizationService,
    {} as TransactionManager,
    {} as EmailService,
    "http://localhost:8080/",
    logger,
  );

  await assert.rejects(
    invitationService.revoke("user-1", "organization-1", "invitation-1"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "invitation_not_found");
      return true;
    },
  );
  assert.equal(revokeCalled, false);
});
