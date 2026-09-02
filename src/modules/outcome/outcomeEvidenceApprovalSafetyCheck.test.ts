import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPairedDeltaApprovalIsSafe,
  buildPairedDeltaProposalId,
  buildSingleDistributionProposalId,
} from "./outcomeEvidenceApprovalSafetyCheck.js";
import { AppError } from "../../shared/errors/appError.js";

test("assertPairedDeltaApprovalIsSafe rejects two tables with different declared cohort tags, even though Python's own grounding should already have caught this", () => {
  assert.throws(
    () =>
      assertPairedDeltaApprovalIsSafe(
        { cohortTag: "Jugendliche", datasetRole: "baseline" },
        { cohortTag: "Mentor:innen", datasetRole: "followup" },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_cross_cohort_pairing_blocked",
  );
});

test("assertPairedDeltaApprovalIsSafe allows pairing when neither table has a declared cohort tag", () => {
  assert.doesNotThrow(() =>
    assertPairedDeltaApprovalIsSafe(
      { datasetRole: "baseline" },
      { datasetRole: "followup" },
    ),
  );
});

// datasetRole is required (never optional) precisely so this case can't
// silently slip through the way it used to when the check treated "both
// undefined" as an implicit pass — two files neither of which has been
// classified are not a safe pairing just because they agree with each
// other; see the "real trust boundary for pre/post direction" comment on
// assertPairedDeltaApprovalIsSafe.
test("assertPairedDeltaApprovalIsSafe rejects two files that are both unclassified", () => {
  assert.throws(
    () =>
      assertPairedDeltaApprovalIsSafe(
        { datasetRole: null },
        { datasetRole: null },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_dataset_role_mismatch",
  );
});

test("assertPairedDeltaApprovalIsSafe allows a real baseline + follow-up pair", () => {
  assert.doesNotThrow(() =>
    assertPairedDeltaApprovalIsSafe(
      { datasetRole: "baseline" },
      { datasetRole: "followup" },
    ),
  );
});

test("assertPairedDeltaApprovalIsSafe rejects when either side's file is unclassified", () => {
  assert.throws(
    () =>
      assertPairedDeltaApprovalIsSafe(
        { datasetRole: "baseline" },
        { datasetRole: null },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_dataset_role_mismatch",
  );
});

test("assertPairedDeltaApprovalIsSafe rejects two files sharing the same datasetRole, even for a manually submitted pairing that never ran the LLM path's own grounding", () => {
  assert.throws(
    () =>
      assertPairedDeltaApprovalIsSafe(
        { datasetRole: "baseline" },
        { datasetRole: "baseline" },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_dataset_role_mismatch",
  );
});

test("buildPairedDeltaProposalId is a stable composite key over both sides' identifying fields", () => {
  const before = {
    uploadMetadataId: "upload-1",
    tableName: "umfrage",
    columnName: "q1_vorher",
  };
  const after = {
    uploadMetadataId: "upload-2",
    tableName: "umfrage",
    columnName: "q1_nachher",
  };

  assert.equal(
    buildPairedDeltaProposalId(before, after),
    buildPairedDeltaProposalId(before, after),
  );
  assert.notEqual(
    buildPairedDeltaProposalId(before, after),
    buildPairedDeltaProposalId(after, before),
  );
});

test("buildSingleDistributionProposalId is a stable composite key over a column's identifying fields", () => {
  const entry = {
    uploadMetadataId: "upload-1",
    tableName: "umfrage",
    columnName: "besuchsgrund",
  };

  assert.equal(
    buildSingleDistributionProposalId(entry),
    buildSingleDistributionProposalId(entry),
  );
  assert.notEqual(
    buildSingleDistributionProposalId(entry),
    buildSingleDistributionProposalId({ ...entry, columnName: "other" }),
  );
});
