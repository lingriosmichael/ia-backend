import assert from "node:assert/strict";
import test from "node:test";
import { approvePrivacyReviewSchema } from "./httpSchemas.js";

test("approvePrivacyReviewSchema rejects a too-short reason when one is provided", () => {
  assert.throws(() =>
    approvePrivacyReviewSchema.parse({
      decisions: {
        fieldDecisions: [
          {
            field: "email",
            entityType: "EMAIL_ADDRESS",
            decision: "keep",
            reason: "not pii",
          },
        ],
      },
    }),
  );
});

test("approvePrivacyReviewSchema accepts an override action with a real reason", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        {
          field: "email",
          entityType: "EMAIL_ADDRESS",
          decision: "keep",
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

test("approvePrivacyReviewSchema accepts a recommended action with no reason", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        { field: "email", entityType: "EMAIL_ADDRESS", decision: "tokenize" },
      ],
    },
  });

  assert.equal(parsed.decisions?.fieldDecisions?.[0]?.reason, undefined);
});

test("approvePrivacyReviewSchema rejects duplicate (field, entityType) decisions", () => {
  // Two entries for the same finding are inherently ambiguous about which
  // decision applies — reject at the boundary rather than let this service
  // and the Python service (which iterates the array separately) each pick
  // a different one.
  assert.throws(() =>
    approvePrivacyReviewSchema.parse({
      decisions: {
        fieldDecisions: [
          { field: "email", entityType: "EMAIL_ADDRESS", decision: "keep" },
          {
            field: "email",
            entityType: "EMAIL_ADDRESS",
            decision: "tokenize",
          },
        ],
      },
    }),
  );
});
