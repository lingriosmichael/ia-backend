import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { ProcessingJobUpdateInput } from "../ai/persistence/aiPersistenceTypes.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewApproveInput } from "./privacyReviewPersistence.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import { PrivacyReviewService } from "./privacyReviewService.js";

function buildJob(
  overrides?: Partial<ProcessingJobPersistenceRecord>,
): ProcessingJobPersistenceRecord {
  return {
    id: "job-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    jobType: "evidence_processing",
    status: "awaiting_privacy_review",
    triggeredById: "user-1",
    payload: null,
    errorMessage: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    attemptCount: 1,
    nextAttemptAt: null,
    failureCode: null,
    maxAttempts: 3,
    createdAt: new Date("2026-07-21T09:00:00.000Z"),
    updatedAt: new Date("2026-07-21T09:00:00.000Z"),
    startedAt: new Date("2026-07-21T08:55:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function createService(overrides?: {
  processingJobRepository?: Partial<ProcessingJobRepository>;
  authorizationService?: Partial<AuthorizationService>;
  privacyReviewRepository?: Partial<PrivacyReviewRepository>;
  parsedRepresentationRepository?: Partial<ParsedRepresentationRepository>;
}) {
  const processingJobRepository = {
    findById: async () => buildJob(),
    update: async (_processingJobId: string, input: ProcessingJobUpdateInput) =>
      buildJob({
        status: input.status ?? "awaiting_privacy_review",
        payload: input.payload ?? null,
        errorMessage: input.errorMessage ?? null,
        leaseOwner: input.leaseOwner ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        lastHeartbeatAt: input.lastHeartbeatAt ?? null,
        attemptCount: input.attemptCount ?? 1,
        nextAttemptAt: input.nextAttemptAt ?? null,
        failureCode: input.failureCode ?? null,
        maxAttempts: input.maxAttempts ?? 3,
        completedAt: input.completedAt ?? null,
      }),
    ...(overrides?.processingJobRepository ?? {}),
  } as unknown as ProcessingJobRepository;

  const authorizationService = {
    canEditProject: async () => undefined,
    ...(overrides?.authorizationService ?? {}),
  } as unknown as AuthorizationService;

  const privacyReviewRepository = {
    findByProcessingJobId: async () => ({
      id: "review-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      processingJobId: "job-1",
      status: "pending",
      findings: {
        summary: [
          {
            field: "email",
            entityType: "EMAIL_ADDRESS",
            recommendedAction: "tokenize",
            requiresDecision: true,
          },
        ],
      },
      decisions: null,
      approvedById: null,
      approvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    approveIfPending: async (
      _processingJobId: string,
      input: PrivacyReviewApproveInput,
    ) => ({
      id: "review-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      processingJobId: "job-1",
      status: "approved",
      findings: {
        summary: [
          {
            field: "email",
            entityType: "EMAIL_ADDRESS",
            recommendedAction: "tokenize",
            requiresDecision: true,
          },
        ],
      },
      decisions: input.decisions,
      approvedById: input.approvedById,
      approvedAt: input.approvedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    ...(overrides?.privacyReviewRepository ?? {}),
  } as unknown as PrivacyReviewRepository;

  const parsedRepresentationRepository = {
    findByProcessingJobId: async () => null,
    ...(overrides?.parsedRepresentationRepository ?? {}),
  } as unknown as ParsedRepresentationRepository;

  return new PrivacyReviewService(
    processingJobRepository,
    authorizationService,
    privacyReviewRepository,
    parsedRepresentationRepository,
  );
}

test("privacy review approval requires acknowledgement when keeping detected data unchanged", async () => {
  const service = createService();

  await assert.rejects(
    service.approve("user-1", "job-1", {
      fieldDecisions: [
        {
          field: "email",
          entityType: "EMAIL_ADDRESS",
          decision: "keep",
        },
      ],
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "privacy_review_keep_acknowledgement_required",
  );
});

test("privacy review approval still requires a decision for a legacy finding stored without recommendedAction", async () => {
  const service = createService({
    privacyReviewRepository: {
      findByProcessingJobId: async () => ({
        id: "review-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        processingJobId: "job-1",
        status: "pending",
        findings: {
          summary: [
            {
              field: "email",
              entityType: "EMAIL_ADDRESS",
              requiresDecision: true,
            },
          ],
        },
        decisions: null,
        approvedById: null,
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  });

  await assert.rejects(
    service.approve("user-1", "job-1", undefined),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "privacy_review_decisions_incomplete",
  );
});

test("privacy review approval requires acknowledgement when keeping a legacy finding unchanged", async () => {
  const service = createService({
    privacyReviewRepository: {
      findByProcessingJobId: async () => ({
        id: "review-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        processingJobId: "job-1",
        status: "pending",
        findings: {
          summary: [
            {
              field: "email",
              entityType: "EMAIL_ADDRESS",
              requiresDecision: true,
            },
          ],
        },
        decisions: null,
        approvedById: null,
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  });

  await assert.rejects(
    service.approve("user-1", "job-1", {
      fieldDecisions: [
        { field: "email", entityType: "EMAIL_ADDRESS", decision: "keep" },
      ],
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "privacy_review_keep_acknowledgement_required",
  );
});

test("privacy review approval accepts the recommended action without a reason", async () => {
  let approvedDecision:
    | {
        field: string;
        entityType: string;
        decision: string;
        reason?: string;
        keepUnchangedAcknowledged?: boolean;
      }
    | undefined;
  let updatedJobInput:
    Parameters<ProcessingJobRepository["update"]>[1] | undefined;

  const service = createService({
    privacyReviewRepository: {
      approveIfPending: async (_processingJobId, input) => {
        approvedDecision = input.decisions.fieldDecisions?.[0];
        return {
          id: "review-1",
          organizationId: "org-1",
          projectId: "project-1",
          activityId: "activity-1",
          uploadMetadataId: "upload-1",
          processingJobId: "job-1",
          status: "approved",
          findings: {
            summary: [
              {
                field: "email",
                entityType: "EMAIL_ADDRESS",
                recommendedAction: "tokenize",
                requiresDecision: true,
              },
            ],
          },
          decisions: input.decisions,
          approvedById: input.approvedById,
          approvedAt: input.approvedAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    processingJobRepository: {
      update: async (_processingJobId, input) => {
        updatedJobInput = input;
        return buildJob({
          status: input.status ?? "awaiting_privacy_review",
          payload: input.payload ?? null,
          errorMessage: input.errorMessage ?? null,
          leaseOwner: input.leaseOwner ?? null,
          leaseExpiresAt: input.leaseExpiresAt ?? null,
          lastHeartbeatAt: input.lastHeartbeatAt ?? null,
          attemptCount: input.attemptCount ?? 1,
          nextAttemptAt: input.nextAttemptAt ?? null,
          failureCode: input.failureCode ?? null,
          maxAttempts: input.maxAttempts ?? 3,
          completedAt: input.completedAt ?? null,
        });
      },
    },
  });

  await service.approve("user-1", "job-1", {
    fieldDecisions: [
      {
        field: "email",
        entityType: "EMAIL_ADDRESS",
        decision: "tokenize",
      },
    ],
  });

  assert.equal(approvedDecision?.decision, "tokenize");
  assert.equal(approvedDecision?.reason, undefined);
  assert.equal(approvedDecision?.keepUnchangedAcknowledged, undefined);
  assert.equal(updatedJobInput?.status, "queued");
  assert.equal(updatedJobInput?.failureCode, null);
  assert.equal(updatedJobInput?.leaseOwner, null);
  assert.equal(updatedJobInput?.leaseExpiresAt, null);
  assert.equal(updatedJobInput?.lastHeartbeatAt, null);
});

test("privacy review approval accepts keep when the acknowledgement is checked", async () => {
  let approvedDecision:
    | {
        field: string;
        entityType: string;
        decision: string;
        keepUnchangedAcknowledged?: boolean;
      }
    | undefined;

  const service = createService({
    privacyReviewRepository: {
      approveIfPending: async (_processingJobId, input) => {
        approvedDecision = input.decisions.fieldDecisions?.[0];
        return {
          id: "review-1",
          organizationId: "org-1",
          projectId: "project-1",
          activityId: "activity-1",
          uploadMetadataId: "upload-1",
          processingJobId: "job-1",
          status: "approved",
          findings: {
            summary: [
              {
                field: "email",
                entityType: "EMAIL_ADDRESS",
                recommendedAction: "tokenize",
                requiresDecision: true,
              },
            ],
          },
          decisions: input.decisions,
          approvedById: input.approvedById,
          approvedAt: input.approvedAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  });

  await service.approve("user-1", "job-1", {
    fieldDecisions: [
      {
        field: "email",
        entityType: "EMAIL_ADDRESS",
        decision: "keep",
        keepUnchangedAcknowledged: true,
      },
    ],
  });

  assert.equal(approvedDecision?.decision, "keep");
  assert.equal(approvedDecision?.keepUnchangedAcknowledged, true);
});
