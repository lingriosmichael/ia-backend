import assert from "node:assert/strict";
import test from "node:test";
import { approvePrivacyReviewSchema } from "./httpSchemas.js";

// A privacy-review override ("rejected" = keep the original, unredacted
// value) is a compliance-sensitive decision — see item 19 of
// "Code Review Remediation Plan — 2026-07-13.md" and the corresponding
// section of Phase 4 — Project Knowledge Model.md. This locks in the
// decided policy: every rejection must carry a real justification.

test("approvePrivacyReviewSchema rejects a 'rejected' decision with no reason", () => {
  assert.throws(() =>
    approvePrivacyReviewSchema.parse({
      decisions: {
        fieldDecisions: [
          { field: "email", entityType: "EMAIL_ADDRESS", decision: "rejected" },
        ],
      },
    }),
  );
});

test("approvePrivacyReviewSchema rejects a 'rejected' decision with a too-short reason", () => {
  assert.throws(() =>
    approvePrivacyReviewSchema.parse({
      decisions: {
        fieldDecisions: [
          {
            field: "email",
            entityType: "EMAIL_ADDRESS",
            decision: "rejected",
            reason: "not pii",
          },
        ],
      },
    }),
  );
});

test("approvePrivacyReviewSchema accepts a 'rejected' decision with a real reason", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        {
          field: "email",
          entityType: "EMAIL_ADDRESS",
          decision: "rejected",
          reason: "This is the organization's shared inbox, not personal data.",
        },
      ],
    },
  });

  assert.equal(
    parsed.decisions?.fieldDecisions?.[0]?.reason,
    "This is the organization's shared inbox, not personal data.",
  );
});

test("approvePrivacyReviewSchema accepts an 'approved' decision with no reason", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        { field: "email", entityType: "EMAIL_ADDRESS", decision: "approved" },
      ],
    },
  });

  assert.equal(parsed.decisions?.fieldDecisions?.[0]?.reason, undefined);
});
