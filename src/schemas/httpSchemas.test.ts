import assert from "node:assert/strict";
import test from "node:test";
import {
  answerActivityAnalysisV2QuestionsSchema,
  approvePrivacyReviewSchema,
} from "./httpSchemas.js";

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

test("answerActivityAnalysisV2QuestionsSchema accepts a batch of distinct answers", () => {
  const parsed = answerActivityAnalysisV2QuestionsSchema.parse({
    answers: [
      { questionId: "q1", answeredValue: "status" },
      { questionId: "q2", answeredValue: "eingang_datum" },
    ],
  });

  assert.equal(parsed.answers.length, 2);
  assert.equal(parsed.answers[0]?.answeredValue, "status");
});

test("answerActivityAnalysisV2QuestionsSchema rejects an empty batch", () => {
  assert.throws(() =>
    answerActivityAnalysisV2QuestionsSchema.parse({ answers: [] }),
  );
});

test("answerActivityAnalysisV2QuestionsSchema rejects a duplicate questionId in the same batch", () => {
  // A batch answering the same question twice is inherently ambiguous
  // about which value should win — reject at the boundary rather than let
  // the service silently apply one and discard the other.
  assert.throws(() =>
    answerActivityAnalysisV2QuestionsSchema.parse({
      answers: [
        { questionId: "q1", answeredValue: "status" },
        { questionId: "q1", answeredValue: "entscheidung" },
      ],
    }),
  );
});

test("answerActivityAnalysisV2QuestionsSchema rejects an empty answeredValue", () => {
  assert.throws(() =>
    answerActivityAnalysisV2QuestionsSchema.parse({
      answers: [{ questionId: "q1", answeredValue: "" }],
    }),
  );
});
