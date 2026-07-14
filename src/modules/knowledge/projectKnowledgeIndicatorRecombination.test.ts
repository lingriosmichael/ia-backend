import { test } from "node:test";
import assert from "node:assert/strict";
import type { InterpretationIndicator } from "../../shared/contracts.js";
import {
  createFakeRepositories,
  buildService,
  makeActivity,
  makeUpload,
  makeInterpretationResult,
} from "./knowledgeBuilderTestFixtures.js";

// Validates the specific problem "Merging computed values" in
// "Phase 4 — Project Knowledge Model.md" exists to solve: when Tier 2
// dedup merges two files' indicators into one KnowledgeEntity, the actual
// numeric value must be recombined from `components`, never by summing or
// averaging each file's already-final `value`. These tests exercise that
// recombination through the full buildForProject pipeline — fake
// repositories, no real MongoDB — matching this module's existing
// convention.

function makeRatioIndicator(
  overrides: Partial<InterpretationIndicator> & {
    numeratorCount: number;
    denominatorCount: number;
  },
): InterpretationIndicator {
  const { numeratorCount, denominatorCount, ...rest } = overrides;
  return {
    id: "indicator-1",
    name: "Attendance rate",
    description: "Share of sessions attended by participants.",
    confidence: 0.9,
    reason: "Derived from the attendanceStatus column.",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept",
    suggestedCalculation: {
      operation: "ratio",
      column: null,
      groupByColumn: null,
      numerator: { column: "attendanceStatus", acceptedValues: ["Present"] },
      denominator: {
        column: "attendanceStatus",
        acceptedValues: ["Present", "Absent"],
      },
      dateColumn: null,
      valueFilter: null,
    },
    computedValue: {
      sourceKind: "computed_from_table",
      value: denominatorCount > 0 ? numeratorCount / denominatorCount : null,
      unit: "ratio",
      components: { numeratorCount, denominatorCount },
      recordsIncluded: denominatorCount,
      recordsExcluded: 0,
      groundingStatus: "passed",
    },
    ...rest,
  };
}

function makeExtractedFromTextIndicator(
  overrides: Partial<InterpretationIndicator> & {
    value: number;
    unit?: string;
  },
): InterpretationIndicator {
  const { value, unit, ...rest } = overrides;
  return {
    id: "indicator-1",
    name: "Attendance rate",
    description: "As explicitly stated in the narrative report.",
    confidence: 0.8,
    reason: "Stated directly in the text.",
    relatedEntityIds: [],
    supportingParagraphKeys: ["P1"],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept",
    suggestedCalculation: null,
    computedValue: {
      sourceKind: "extracted_from_text",
      value,
      unit: unit ?? "as_stated",
      components: {},
      recordsIncluded: 0,
      recordsExcluded: 0,
      groundingStatus: "passed",
    },
    ...rest,
  };
}

function makeCountDistinctIndicator(
  overrides: Partial<InterpretationIndicator> & { count: number },
): InterpretationIndicator {
  const { count, ...rest } = overrides;
  return {
    id: "indicator-1",
    name: "Unique participants",
    description: "Distinct participants recorded in this file.",
    confidence: 0.9,
    reason: "Derived from the participantId column.",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept",
    suggestedCalculation: {
      operation: "count_distinct",
      column: "participantId",
      groupByColumn: null,
      numerator: null,
      denominator: null,
      dateColumn: null,
      valueFilter: null,
    },
    computedValue: {
      sourceKind: "computed_from_table",
      value: count,
      unit: "count",
      components: { count },
      recordsIncluded: count,
      recordsExcluded: 0,
      groundingStatus: "passed",
    },
    ...rest,
  };
}

test("a single source instance's ratio computes as not_applicable for dedup and matches its own value", async () => {
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [
        makeRatioIndicator({ numeratorCount: 41, denominatorCount: 50 }),
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeIndicators.length, 1);
  const indicator = repos.knowledgeIndicators[0]!;
  assert.equal(indicator.value, 41 / 50);
  assert.equal(indicator.deduplicationConfidence, "not_applicable");
});

test("merging two files' ratios recombines via numerator/denominator sums, not by averaging the two already-divided rates", async () => {
  // File A: 41/50 = 0.82. File B: 9/50 = 0.18. Naive average of the two
  // rates would be 0.50 — visibly different from, and wrong relative to,
  // the correct combined rate of (41+9)/(50+50) = 0.50... deliberately
  // pick asymmetric sample sizes so naive averaging and correct
  // recombination diverge instead of coincidentally matching.
  const activities = [makeActivity({})];
  const uploads = [
    makeUpload({ id: "upload-1" }),
    makeUpload({ id: "upload-2" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      uploadMetadataId: "upload-1",
      indicators: [
        makeRatioIndicator({ numeratorCount: 90, denominatorCount: 100 }),
      ],
    }),
    makeInterpretationResult({
      id: "result-2",
      uploadMetadataId: "upload-2",
      indicators: [
        makeRatioIndicator({ numeratorCount: 1, denominatorCount: 10 }),
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  // Correct: (90 + 1) / (100 + 10) = 91/110.
  // Wrong (naive average of 0.90 and 0.10): 0.50 — visibly different.
  const correctValue = 91 / 110;
  const naiveAverage = (90 / 100 + 1 / 10) / 2;
  assert.notEqual(
    Math.round(correctValue * 1000),
    Math.round(naiveAverage * 1000),
    "test fixture must produce a case where naive averaging is visibly wrong",
  );

  assert.equal(
    repos.knowledgeEntities.length,
    1,
    "the two files' indicators must merge into one entity",
  );
  assert.equal(repos.knowledgeIndicators.length, 1);
  assert.equal(repos.knowledgeIndicators[0]!.value, correctValue);
});

test("merging two files' count_distinct sums the counts and honestly flags the result as not deduplicated across sources", async () => {
  const activities = [makeActivity({})];
  const uploads = [
    makeUpload({ id: "upload-1" }),
    makeUpload({ id: "upload-2" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      uploadMetadataId: "upload-1",
      indicators: [makeCountDistinctIndicator({ count: 12 })],
    }),
    makeInterpretationResult({
      id: "result-2",
      uploadMetadataId: "upload-2",
      indicators: [makeCountDistinctIndicator({ count: 8 })],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeIndicators.length, 1);
  const indicator = repos.knowledgeIndicators[0]!;
  assert.equal(indicator.value, 20);
  assert.equal(
    indicator.deduplicationConfidence,
    "not_deduplicated_across_sources",
  );
});

test("a single file's count_distinct is not flagged as undeduplicated, since no merge happened", async () => {
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [makeCountDistinctIndicator({ count: 12 })],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(
    repos.knowledgeIndicators[0]!.deduplicationConfidence,
    "not_applicable",
  );
});

test("an indicator with no computed value (concept-only) produces no KnowledgeIndicator record", async () => {
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [
        {
          id: "indicator-1",
          name: "Mentor training completion",
          description: "A qualitative concept with no computable value.",
          confidence: 0.7,
          reason: "No suggestedCalculation was grounded for this file.",
          relatedEntityIds: [],
          supportingParagraphKeys: [],
          relevanceStage: null,
          matchesStatedGoal: false,
          status: "kept",
          suggestedCalculation: null,
          computedValue: null,
        },
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(
    repos.knowledgeEntities.length,
    1,
    "the concept entity is still built",
  );
  assert.equal(
    repos.knowledgeIndicators.length,
    0,
    "but no numeric value exists for it",
  );
});

test("a failed-grounding computed value is never used, even though the indicator entity still merges", async () => {
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [
        makeRatioIndicator({
          numeratorCount: 5,
          denominatorCount: 10,
          computedValue: {
            sourceKind: "computed_from_table",
            value: null,
            unit: null,
            components: {},
            recordsIncluded: 0,
            recordsExcluded: 0,
            groundingStatus: "failed_column_not_found",
          },
        }),
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeIndicators.length, 0);
});

test("a narrative extracted-from-text indicator produces a KnowledgeIndicator from its own stated value", async () => {
  // Regression test: extracted-from-text computed values carry no
  // `operation` (they're a stated fact, not a tabular aggregation), and
  // recombineComputedValues used to treat a null operation as "nothing to
  // recombine," silently dropping every narrative indicator regardless of
  // how well-grounded its value was.
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [makeExtractedFromTextIndicator({ value: 82, unit: "%" })],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeIndicators.length, 1);
  const indicator = repos.knowledgeIndicators[0]!;
  assert.equal(indicator.value, 82);
  assert.equal(indicator.unit, "%");
  assert.equal(indicator.deduplicationConfidence, "not_applicable");
});

test("a computed value's real unit is preserved instead of being replaced by the operation name", async () => {
  const activities = [makeActivity({})];
  const uploads = [makeUpload({})];
  const interpretationResults = [
    makeInterpretationResult({
      indicators: [
        makeRatioIndicator({
          numeratorCount: 41,
          denominatorCount: 50,
          computedValue: {
            sourceKind: "computed_from_table",
            value: 41 / 50,
            unit: "%",
            components: { numeratorCount: 41, denominatorCount: 50 },
            recordsIncluded: 50,
            recordsExcluded: 0,
            groundingStatus: "passed",
          },
        }),
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeIndicators[0]!.unit, "%");
});

test("two independently-stated narrative values for the same indicator concept are left unresolved rather than guessed at", async () => {
  const activities = [makeActivity({})];
  const uploads = [
    makeUpload({ id: "upload-1" }),
    makeUpload({ id: "upload-2" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      uploadMetadataId: "upload-1",
      indicators: [makeExtractedFromTextIndicator({ value: 82, unit: "%" })],
    }),
    makeInterpretationResult({
      id: "result-2",
      uploadMetadataId: "upload-2",
      indicators: [makeExtractedFromTextIndicator({ value: 91, unit: "%" })],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(
    repos.knowledgeEntities.length,
    1,
    "still merges as one concept",
  );
  assert.equal(
    repos.knowledgeIndicators.length,
    0,
    "but two independently-stated numbers must not produce a guessed combined value",
  );
});

test("merging instances with mismatched operations fails closed instead of guessing", async () => {
  const activities = [makeActivity({})];
  const uploads = [
    makeUpload({ id: "upload-1" }),
    makeUpload({ id: "upload-2" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      uploadMetadataId: "upload-1",
      indicators: [
        makeRatioIndicator({ numeratorCount: 5, denominatorCount: 10 }),
      ],
    }),
    makeInterpretationResult({
      id: "result-2",
      uploadMetadataId: "upload-2",
      indicators: [
        makeRatioIndicator({
          numeratorCount: 0,
          denominatorCount: 0,
          suggestedCalculation: {
            operation: "count",
            column: "attendanceStatus",
            groupByColumn: null,
            numerator: null,
            denominator: null,
            dateColumn: null,
            valueFilter: null,
          },
          computedValue: {
            sourceKind: "computed_from_table",
            value: 7,
            unit: "count",
            components: { count: 7 },
            recordsIncluded: 7,
            recordsExcluded: 0,
            groundingStatus: "passed",
          },
        }),
      ],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);

  await service.buildForProject("project-1");

  assert.equal(
    repos.knowledgeEntities.length,
    1,
    "still merges as one concept",
  );
  assert.equal(
    repos.knowledgeIndicators.length,
    0,
    "but a mismatched operation across sources must not produce a guessed value",
  );
});
