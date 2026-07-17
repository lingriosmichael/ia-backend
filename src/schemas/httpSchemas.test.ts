import assert from "node:assert/strict";
import test from "node:test";
import { approvePrivacyReviewSchema } from "./httpSchemas.js";

test("approvePrivacyReviewSchema accepts keep acknowledgement", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        {
          field: "email",
          entityType: "EMAIL_ADDRESS",
          decision: "keep",
          keepUnchangedAcknowledged: true,
        },
      ],
    },
  });

  assert.equal(
    parsed.decisions?.fieldDecisions?.[0]?.keepUnchangedAcknowledged,
    true,
  );
});

test("approvePrivacyReviewSchema still accepts legacy override reason payloads", () => {
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

test("approvePrivacyReviewSchema accepts tokenize with no acknowledgement", () => {
  const parsed = approvePrivacyReviewSchema.parse({
    decisions: {
      fieldDecisions: [
        { field: "email", entityType: "EMAIL_ADDRESS", decision: "tokenize" },
      ],
    },
  });

  assert.equal(parsed.decisions?.fieldDecisions?.[0]?.reason, undefined);
  assert.equal(
    parsed.decisions?.fieldDecisions?.[0]?.keepUnchangedAcknowledged,
    undefined,
  );
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
