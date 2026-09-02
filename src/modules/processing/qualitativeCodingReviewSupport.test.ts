import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssignedCodeLabelsByColumn,
  qualitativeCodingReviewRequirementStatus,
  requiresQualitativeCodingReview,
} from "./qualitativeCodingReviewSupport.js";

function approvedReview(overrides?: {
  status?: "pending" | "approved" | "rejected";
  approveFinding?: boolean;
}) {
  return {
    status: overrides?.status ?? "approved",
    findings: {
      summary: [
        {
          findingKey: "feedback::baseline_note",
          tableName: "feedback",
          textColumnName: "baseline_note",
          syntheticCodeColumnName: "baseline_note_coded",
          rowCount: 3,
          nonEmptyRowCount: 3,
          proposedCodes: [
            {
              code: "preparedness",
              label: "Preparedness",
              description: "Statements about feeling more prepared.",
              exampleExcerpts: ["I felt more prepared."],
            },
            {
              code: "empathy_expressed",
              label: "Empathy expressed",
              description: "Statements expressing empathy.",
              exampleExcerpts: [],
            },
          ],
          proposedAssignments: [{ rowIndex: 0, assignedCode: "preparedness" }],
        },
      ],
    },
    decisions: {
      columnDecisions:
        overrides?.approveFinding === false
          ? []
          : [
              {
                findingKey: "feedback::baseline_note",
                decision: "approve_as_proposed" as const,
                decidedById: "user-1",
                decidedAt: "2026-08-11T10:00:00.000Z",
              },
            ],
    },
  };
}

test("buildAssignedCodeLabelsByColumn resolves an approved finding's codes to their human labels", () => {
  const result = buildAssignedCodeLabelsByColumn([approvedReview()]);

  const codeLabels = result.get("baseline_note_coded");
  assert.equal(codeLabels?.get("preparedness"), "Preparedness");
  assert.equal(codeLabels?.get("empathy_expressed"), "Empathy expressed");
});

test("buildAssignedCodeLabelsByColumn ignores a review that is not approved", () => {
  const result = buildAssignedCodeLabelsByColumn([
    approvedReview({ status: "pending" }),
  ]);

  assert.equal(result.has("baseline_note_coded"), false);
});

test("buildAssignedCodeLabelsByColumn ignores a finding the reviewer never approved", () => {
  const result = buildAssignedCodeLabelsByColumn([
    approvedReview({ approveFinding: false }),
  ]);

  assert.equal(result.has("baseline_note_coded"), false);
});

test("buildAssignedCodeLabelsByColumn tolerates null/malformed reviews without throwing", () => {
  const result = buildAssignedCodeLabelsByColumn([
    null,
    { status: "approved", findings: {}, decisions: null },
  ]);

  assert.equal(result.size, 0);
});

test("buildAssignedCodeLabelsByColumn merges columns from multiple reviews into one lookup", () => {
  const secondReview = approvedReview();
  secondReview.findings.summary[0]!.syntheticCodeColumnName = "other_coded";

  const result = buildAssignedCodeLabelsByColumn([
    approvedReview(),
    secondReview,
  ]);

  assert.equal(
    result.get("baseline_note_coded")?.get("preparedness"),
    "Preparedness",
  );
  assert.equal(result.get("other_coded")?.get("preparedness"), "Preparedness");
});

test("requiresQualitativeCodingReview ignores sparse free-text columns", () => {
  // rowCount 5, 60% null → ~2 non-empty rows, below the 3-row threshold.
  // Deliberately rowCount !== the intended non-null count, so this only
  // passes if the approximation genuinely reads nullPercentage rather than
  // falling back to the table's raw rowCount.
  const datasetProfile = {
    tables: [
      {
        rowCount: 5,
        columns: [
          {
            name: "reflection_note",
            epistemicRole: "free_text",
            nullPercentage: 60,
          },
        ],
      },
    ],
  } as const;

  assert.equal(requiresQualitativeCodingReview(datasetProfile as never), false);
  assert.equal(
    qualitativeCodingReviewRequirementStatus(datasetProfile as never, null),
    "not_required",
  );
});

test("requiresQualitativeCodingReview still flags reviewable free-text columns", () => {
  // rowCount 5, 20% null → ~4 non-empty rows, at/above the 3-row threshold.
  // Same "rowCount !== intended non-null count" shape as the sparse case
  // above, to prove this isn't just falling back to rowCount.
  const datasetProfile = {
    tables: [
      {
        rowCount: 5,
        columns: [
          {
            name: "reflection_note",
            epistemicRole: "free_text",
            nullPercentage: 20,
          },
        ],
      },
    ],
  } as const;

  assert.equal(requiresQualitativeCodingReview(datasetProfile as never), true);
  assert.equal(
    qualitativeCodingReviewRequirementStatus(datasetProfile as never, null),
    "required_pending",
  );
});
