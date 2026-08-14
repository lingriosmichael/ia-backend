import assert from "node:assert/strict";
import test from "node:test";
import {
  qualitativeCodingReviewRequirementStatus,
  requiresQualitativeCodingReview,
} from "./qualitativeCodingReviewSupport.js";

test("requiresQualitativeCodingReview ignores sparse free-text columns", () => {
  const datasetProfile = {
    tables: [
      {
        rowCount: 2,
        columns: [
          {
            name: "reflection_note",
            epistemicRole: "free_text",
            nonNullCount: 2,
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
  const datasetProfile = {
    tables: [
      {
        rowCount: 4,
        columns: [
          {
            name: "reflection_note",
            epistemicRole: "free_text",
            nonNullCount: 4,
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
