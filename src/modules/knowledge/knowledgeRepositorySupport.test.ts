import assert from "node:assert/strict";
import test from "node:test";
import {
  toKnowledgeSourceInstanceDocument,
  toKnowledgeSourceInstanceRecord,
} from "./knowledgeRepositorySupport.js";

test("knowledge source instance mapping preserves computed and qualitative context", () => {
  const instance = {
    uploadMetadataId: "upload-1",
    interpretationResultId: "result-1",
    activityId: "activity-1",
    activityType: "mentoring",
    sourceReference: "Attendance improved",
    addedAt: "2026-01-01T00:00:00.000Z",
    computedValue: {
      sourceKind: "computed_from_table" as const,
      operation: "ratio" as const,
      value: 0.82,
      unit: "ratio",
      components: { numeratorCount: 82, denominatorCount: 100 },
      groundingStatus: "passed" as const,
      confidence: 0.91,
    },
    qualitativeContext: {
      category: "outcome_support" as const,
      outcomeReference: "Participants report stronger confidence.",
      outcomeAnchorType: "project_outcome" as const,
      relationToEvidence: "reinforces" as const,
    },
  };

  const asDocument = toKnowledgeSourceInstanceDocument(instance);
  const roundTripped = toKnowledgeSourceInstanceRecord(asDocument);

  assert.deepEqual(roundTripped, instance);
});
