import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import { hasPendingBlockingQuestions } from "../interpretation/interpretationReviewState.js";
import type { ActivityWorkflowStage } from "../../shared/contracts.js";

export type { ActivityWorkflowStage } from "../../shared/contracts.js";

const TERMINAL_JOB_STATUSES: ReadonlySet<
  ProcessingJobPersistenceRecord["status"]
> = new Set(["completed", "failed", "cancelled"]);

const EVIDENCE_PROCESSING_JOB_TYPES: ReadonlySet<
  ProcessingJobPersistenceRecord["jobType"]
> = new Set(["evidence_processing", "workbook_split"]);

type WorkflowStageJob = Pick<
  ProcessingJobPersistenceRecord,
  "uploadMetadataId" | "jobType" | "status" | "createdAt"
>;

export interface ActivityWorkflowStageInput {
  isAcknowledged: boolean;
  uploadIds: string[];
  jobs: WorkflowStageJob[];
  results: Array<
    InterpretationResultPersistenceRecord & {
      privacySafePayload?: Record<string, unknown> | null;
    }
  >;
  hasPendingQualitativeCodingReview: boolean;
  /**
   * Whether ActivityEvidenceLinkageResultRepository.findByActivityId
   * returned a record for this activity. Only meaningful (and only
   * checked) once the activity has 2+ uploads — see
   * EvidenceLinkageReconciliationService, which persists a record (even
   * with `groups: []`) precisely so this can distinguish "reconciliation
   * ran and found nothing to join" from "hasn't run yet."
   */
  hasLinkageResultIfApplicable: boolean;
}

function getLatestEvidenceProcessingJobStatus(
  jobs: WorkflowStageJob[],
  uploadMetadataId: string,
): ProcessingJobPersistenceRecord["status"] | null {
  const relevantJobs = jobs.filter(
    (job) =>
      job.uploadMetadataId === uploadMetadataId &&
      EVIDENCE_PROCESSING_JOB_TYPES.has(job.jobType),
  );

  if (relevantJobs.length === 0) {
    return null;
  }

  const latest = [...relevantJobs].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )[0];
  return latest?.status ?? null;
}

/**
 * Pure (no I/O): derives an activity's workflow stage from its uploads,
 * processing jobs, interpretation results, and evidence-linkage state.
 */
export function computeActivityWorkflowStage(
  input: ActivityWorkflowStageInput,
): ActivityWorkflowStage {
  if (input.uploadIds.length === 0) {
    return "no_evidence";
  }

  if (input.isAcknowledged) {
    return "reviewed";
  }

  const hasPendingPrivacyReview = input.uploadIds.some(
    (uploadId) =>
      getLatestEvidenceProcessingJobStatus(input.jobs, uploadId) ===
      "awaiting_privacy_review",
  );
  if (hasPendingPrivacyReview) {
    return "privacy_review";
  }

  const hasActiveInterpretationJob = input.jobs.some(
    (job) =>
      job.jobType === "dataset_interpretation" &&
      !TERMINAL_JOB_STATUSES.has(job.status),
  );
  if (hasActiveInterpretationJob) {
    return "analysis_running";
  }

  const isFullyInterpreted =
    input.results.length > 0 && input.results.length === input.uploadIds.length;
  if (!isFullyInterpreted) {
    return "analysis_pending";
  }

  if (hasPendingBlockingQuestions(input.results)) {
    return "needs_clarification";
  }

  if (input.hasPendingQualitativeCodingReview) {
    return "qualitative_review";
  }

  if (input.uploadIds.length >= 2 && !input.hasLinkageResultIfApplicable) {
    return "goal_review";
  }

  return "assessment_ready";
}
