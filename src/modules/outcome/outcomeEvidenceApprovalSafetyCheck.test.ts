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
        { cohortTag: "Jugendliche" },
        { cohortTag: "Mentor:innen" },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "outcome_evidence_pairing_cross_cohort_pairing_blocked",
  );
});

test("assertPairedDeltaApprovalIsSafe allows pairing when neither table has a declared cohort tag", () => {
  assert.doesNotThrow(() => assertPairedDeltaApprovalIsSafe({}, {}));
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
