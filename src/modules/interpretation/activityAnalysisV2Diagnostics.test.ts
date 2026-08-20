import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityAnalysisV2Diagnostics } from "./activityAnalysisV2Diagnostics.js";

const BASE_INPUT = {
  goals: [{ goalType: "output" as const }],
  evidenceCount: 1,
  plannedToolRequestCount: 0,
  executedToolCallCount: 0,
  calculationCount: 0,
  validation: { status: "passed" as const, issues: [] },
  assessment: null,
};

test("buildActivityAnalysisV2Diagnostics defaults contextExtraction to all zeros when omitted", () => {
  const diagnostics = buildActivityAnalysisV2Diagnostics(BASE_INPUT);

  assert.deepEqual(diagnostics.contextExtraction, {
    totalCategoricalColumnsSeen: 0,
    contextCandidatesProposed: 0,
    contextCandidatesExcludedByReferencedStrings: 0,
    contextCandidatesExcludedByMissingEpistemicRole: 0,
    contextCandidatesMaterialized: 0,
    preparedTableFallbackTableCount: 0,
  });
});

test("buildActivityAnalysisV2Diagnostics passes contextExtraction counts through unchanged", () => {
  const diagnostics = buildActivityAnalysisV2Diagnostics({
    ...BASE_INPUT,
    contextExtraction: {
      totalCategoricalColumnsSeen: 4,
      contextCandidatesProposed: 2,
      contextCandidatesExcludedByReferencedStrings: 2,
      contextCandidatesExcludedByMissingEpistemicRole: 1,
      contextCandidatesMaterialized: 2,
      preparedTableFallbackTableCount: 1,
    },
  });

  assert.deepEqual(diagnostics.contextExtraction, {
    totalCategoricalColumnsSeen: 4,
    contextCandidatesProposed: 2,
    contextCandidatesExcludedByReferencedStrings: 2,
    contextCandidatesExcludedByMissingEpistemicRole: 1,
    contextCandidatesMaterialized: 2,
    preparedTableFallbackTableCount: 1,
  });
});
