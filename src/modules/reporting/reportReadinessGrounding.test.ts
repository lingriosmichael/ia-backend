import assert from "node:assert/strict";
import test from "node:test";
import type {
  EvidenceCatalog,
  EvidenceCatalogMetricEntry,
  EvidenceCatalogThemeEntry,
  ReportReadinessCheckResult,
} from "../analytics/analyticsContracts.js";
import { groundReportReadinessCheckResult } from "./reportReadinessGrounding.js";

function metricEntry(
  overrides: Partial<EvidenceCatalogMetricEntry> = {},
): EvidenceCatalogMetricEntry {
  return {
    entryId: "metric-attendance",
    entryType: "METRIC",
    label: "Attendance rate",
    description: "Share of sessions attended.",
    value: 0.82,
    unit: "ratio",
    deduplicationConfidence: "not_applicable",
    activityId: "activity-1",
    provenance: {
      knowledgeEntityId: "entity-1",
      uploadMetadataId: "upload-1",
      interpretationResultId: "result-1",
      sourceReference: "Attendance rate",
    },
    evidenceStrength: "strong",
    ...overrides,
  };
}

function themeEntry(
  overrides: Partial<EvidenceCatalogThemeEntry> = {},
): EvidenceCatalogThemeEntry {
  return {
    entryId: "theme-mentoring-support",
    entryType: "QUALITATIVE_THEME",
    label: "Mentoring support",
    description: "Mentees describe feeling supported.",
    quoteCount: 3,
    categories: [],
    outcomeReferences: [],
    outcomeAnchorTypes: [],
    sourceActivityIds: ["activity-1"],
    sourceUploadMetadataIds: ["upload-1"],
    sourceInstances: [],
    ...overrides,
  };
}

function catalog(
  entries: EvidenceCatalog["entries"],
  omittedEntries: EvidenceCatalog["omittedEntries"] = [],
): EvidenceCatalog {
  return {
    catalogVersion: "3.0",
    knowledgeModelVersion: 1,
    scope: { type: "PROJECT", projectId: "project-1", activityId: null },
    entries,
    omittedEntries,
    qualitySignals: [],
  };
}

function response(
  overrides: Partial<Omit<ReportReadinessCheckResult, "generatedAt">> = {},
): Omit<ReportReadinessCheckResult, "generatedAt"> {
  return {
    overallReadiness: { level: "ready_with_caveats", rationale: "..." },
    evidenceSummary: [],
    confidentlyReportable: [],
    reportableWithCaveats: [],
    missingOrWeakEvidence: [],
    deviationsRequiringExplanation: [],
    honestEmergingStory: {
      narrative: "...",
      sourceEntryIds: [],
      sourceLabels: [],
    },
    actionsBeforeReporting: [],
    improvementsForNextPeriod: [],
    groundingStatus: "PASSED",
    groundingRetryCount: 0,
    reportReadinessModelVersion: "report-readiness-prompt-v2",
    fellBackToSelectionOnly: false,
    ...overrides,
  };
}

test("re-derives sourceLabels and evidenceStrength from the real catalog rather than trusting Python's values", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      confidentlyReportable: [
        {
          statement: "Attendance was recorded at 82%.",
          sourceEntryIds: ["metric-attendance"],
          // Deliberately wrong, as if Python's own derivation had drifted —
          // the backend must not trust this and must recompute it.
          sourceLabels: ["some other label"],
          kind: "observed_fact",
          caveat: null,
          evidenceStrength: "weak",
        },
      ],
    }),
    catalog([metricEntry({ evidenceStrength: "strong" })]),
  );

  assert.equal(grounded.confidentlyReportable.length, 1);
  assert.deepEqual(grounded.confidentlyReportable[0]?.sourceLabels, [
    "Attendance rate",
  ]);
  assert.equal(grounded.confidentlyReportable[0]?.evidenceStrength, "strong");
});

test("drops a finding whose only cited entry does not exist in the real catalog", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      confidentlyReportable: [
        {
          statement: "Mentors report the program is highly effective.",
          sourceEntryIds: ["entry-that-does-not-exist"],
          sourceLabels: ["Fabricated label"],
          kind: "observed_fact",
          caveat: null,
          evidenceStrength: "strong",
        },
      ],
    }),
    catalog([metricEntry()]),
  );

  assert.deepEqual(grounded.confidentlyReportable, []);
});

test("filters an unknown entry id out of a multi-source claim instead of dropping the whole claim", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      evidenceSummary: [
        {
          area: "Attendance",
          whatWeKnow: "Attendance was strong and mentors were supportive.",
          sourceEntryIds: ["metric-attendance", "entry-that-does-not-exist"],
          sourceLabels: [],
          confidence: null,
          mainGap: "No breakdown by cohort is available.",
        },
      ],
    }),
    catalog([metricEntry()]),
  );

  assert.deepEqual(grounded.evidenceSummary[0]?.sourceEntryIds, [
    "metric-attendance",
  ]);
  assert.deepEqual(grounded.evidenceSummary[0]?.sourceLabels, [
    "Attendance rate",
  ]);
});

test("a claim citing only a QUALITATIVE_THEME entry has no evidenceStrength (themes carry no confidence signal)", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      confidentlyReportable: [
        {
          statement: "Mentees describe feeling supported.",
          sourceEntryIds: ["theme-mentoring-support"],
          sourceLabels: [],
          kind: "observed_fact",
          caveat: null,
          evidenceStrength: "strong",
        },
      ],
    }),
    catalog([themeEntry()]),
  );

  assert.equal(grounded.confidentlyReportable[0]?.evidenceStrength, null);
});

test("filters an unknown omitted-entry id out of a gap finding without dropping the finding", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      missingOrWeakEvidence: [
        {
          gap: "No outcome-level indicator has been computed yet.",
          whyItMattersForReporting: "Funders will expect an outcome figure.",
          relatedOmittedEntryIds: ["entity-omitted", "entity-does-not-exist"],
        },
      ],
    }),
    catalog(
      [],
      [
        {
          knowledgeEntityId: "entity-omitted",
          reason: "No computed value yet.",
        },
      ],
    ),
  );

  assert.equal(grounded.missingOrWeakEvidence.length, 1);
  assert.deepEqual(grounded.missingOrWeakEvidence[0]?.relatedOmittedEntryIds, [
    "entity-omitted",
  ]);
});

test("re-grounds the honest emerging story's citations without dropping it (it is a required singular field)", () => {
  const grounded = groundReportReadinessCheckResult(
    response({
      honestEmergingStory: {
        narrative:
          "Attendance stayed high alongside a recurring support theme.",
        sourceEntryIds: ["metric-attendance", "entry-that-does-not-exist"],
        sourceLabels: [],
      },
    }),
    catalog([metricEntry()]),
  );

  assert.deepEqual(grounded.honestEmergingStory.sourceEntryIds, [
    "metric-attendance",
  ]);
  assert.deepEqual(grounded.honestEmergingStory.sourceLabels, [
    "Attendance rate",
  ]);
});
