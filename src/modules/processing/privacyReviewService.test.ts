import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ParsedRepresentationRepository } from "./parsedRepresentationRepository.js";
import type { PrivacyReviewApproveInput } from "./privacyReviewPersistence.js";
import type { PrivacyReviewRepository } from "./privacyReviewRepository.js";
import { PrivacyReviewService } from "./privacyReviewService.js";
import type { PythonProcessingClient } from "./pythonProcessingClient.js";

function createService(overrides?: {
  processingJobRepository?: Partial<ProcessingJobRepository>;
  authorizationService?: Partial<AuthorizationService>;
  pythonProcessingClient?: Partial<PythonProcessingClient>;
  privacyReviewRepository?: Partial<PrivacyReviewRepository>;
  parsedRepresentationRepository?: Partial<ParsedRepresentationRepository>;
}) {
  const processingJobRepository = {
    findById: async () => ({
      id: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      jobType: "evidence_processing",
      status: "awaiting_privacy_review",
      triggeredById: "user-1",
      payload: {
        pythonJob: {
          externalJobId: "python-job-1",
        },
      },
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    }),
    update: async () => ({
      id: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      jobType: "evidence_processing",
      status: "transforming",
      triggeredById: "user-1",
      payload: {
        pythonJob: {
          externalJobId: "python-job-1",
          status: "completed",
          updatedAt: new Date().toISOString(),
          details: null,
        },
      },
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
    }),
    ...(overrides?.processingJobRepository ?? {}),
  } as unknown as ProcessingJobRepository;

  const authorizationService = {
    canEditProject: async () => undefined,
    ...(overrides?.authorizationService ?? {}),
  } as unknown as AuthorizationService;

  const pythonProcessingClient = {
    approvePrivacyReview: async () => ({
      externalJobId: "python-job-1",
      status: "completed",
      updatedAt: new Date().toISOString(),
      errorMessage: null,
      details: null,
    }),
    ...(overrides?.pythonProcessingClient ?? {}),
  } as unknown as PythonProcessingClient;

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
    pythonProcessingClient,
    privacyReviewRepository,
    parsedRepresentationRepository,
  );
}

test("privacy review approval requires a reason when overriding the recommended action", async () => {
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
      error.code === "privacy_review_override_reason_required",
  );
});

test("privacy review approval still requires a decision and a reason for a legacy finding stored without recommendedAction", async () => {
  // Simulates a review that was created before recommendedAction existed on
  // this shape — a finding still in "awaiting_privacy_review" at deploy time.
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
              // recommendedAction intentionally absent.
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

  await assert.rejects(
    service.approve("user-1", "job-1", {
      fieldDecisions: [
        { field: "email", entityType: "EMAIL_ADDRESS", decision: "tokenize" },
      ],
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "privacy_review_override_reason_required",
  );
});

test("privacy review approval accepts the recommended action without a reason", async () => {
  let forwardedDecision:
    | { field: string; entityType: string; decision: string; reason?: string }
    | undefined;

  const service = createService({
    pythonProcessingClient: {
      approvePrivacyReview: async (_externalJobId, decisions) => {
        forwardedDecision = decisions.fieldDecisions?.[0];
        return {
          externalJobId: "python-job-1",
          status: "completed",
          updatedAt: new Date().toISOString(),
          errorMessage: null,
          details: null,
        };
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

  assert.equal(forwardedDecision?.decision, "tokenize");
  assert.equal(forwardedDecision?.reason, undefined);
});
