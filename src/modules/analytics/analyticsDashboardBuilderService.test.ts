import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsDashboardBuilderService } from "./analyticsDashboardBuilderService.js";
import type {
  DashboardCuration,
  EvidenceCatalog,
} from "./analyticsContracts.js";
import type { DeterministicAnalysisPersistenceRecord } from "../interpretation/deterministicAnalysisPersistence.js";

function makeCatalog(): EvidenceCatalog {
  return {
    catalogVersion: "3.0",
    knowledgeModelVersion: 1,
    scope: {
      type: "PROJECT",
      projectId: "project-1",
      activityId: null,
    },
    entries: [
      {
        entryId: "metric-1",
        entryType: "METRIC",
        label: "Attendance rate",
        description: "Share of participants attending sessions.",
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
      },
      {
        entryId: "metric-2",
        entryType: "METRIC",
        label: "Completion rate",
        description: "Share of participants completing the programme.",
        value: 0.67,
        unit: "ratio",
        deduplicationConfidence: "not_applicable",
        activityId: "activity-1",
        provenance: {
          knowledgeEntityId: "entity-2",
          uploadMetadataId: "upload-1",
          interpretationResultId: "result-1",
          sourceReference: "Completion rate",
        },
      },
      {
        entryId: "theme-1",
        entryType: "QUALITATIVE_THEME",
        label: "Mentors requested more preparation time",
        description: "Interviewees repeatedly described compressed onboarding.",
        quoteCount: 3,
        categories: ["barrier"],
        outcomeReferences: ["Participants sustain mentor relationships."],
        outcomeAnchorTypes: ["project_outcome"],
        sourceActivityIds: ["activity-1"],
        sourceUploadMetadataIds: ["upload-2"],
      },
    ],
    omittedEntries: [],
    qualitySignals: [],
  };
}

function makeDeterministicAnalysis(): DeterministicAnalysisPersistenceRecord {
  return {
    id: "analysis-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "privacy-1",
    interpretationResultId: "result-1",
    datasetPreparationId: "prep-1",
    status: "ready",
    metrics: [],
    distributions: [
      {
        distributionKey: "recommendation_distribution",
        label: "Recommendation distribution",
        tableName: "responses",
        columnName: "recommendation",
        buckets: [
          { value: "Suitable", count: 14, ratio: 0.58 },
          { value: "Conditional", count: 7, ratio: 0.29 },
          { value: "Unsuitable", count: 3, ratio: 0.13 },
        ],
      },
    ],
    trends: [
      {
        trendKey: "attendance_over_time",
        label: "Attendance over time",
        tableName: "responses",
        dateColumnName: "submitted_at",
        positiveStatusColumnName: "attended",
        points: [
          {
            period: "2026-01",
            rowCount: 10,
            positiveCount: 6,
            positiveRatio: 0.6,
          },
          {
            period: "2026-02",
            rowCount: 12,
            positiveCount: 9,
            positiveRatio: 0.75,
          },
        ],
      },
    ],
    subgroupBreakdowns: [
      {
        breakdownKey: "attendance_by_group",
        label: "Attendance by target group",
        tableName: "responses",
        columnName: "target_group",
        segments: [
          {
            value: "New mentors",
            rowCount: 12,
            positiveCount: 8,
            positiveRatio: 0.67,
          },
          {
            value: "Returning mentors",
            rowCount: 9,
            positiveCount: 8,
            positiveRatio: 0.89,
          },
        ],
      },
    ],
    categoricalCrosstabs: [],
    numericCategorySummaries: [],
    numericCorrelations: [],
    warnings: [],
    candidateIndicators: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const CURATION: DashboardCuration = {
  featuredEntryIds: ["metric-1", "theme-1"],
  narrative: [
    {
      text: "Attendance and mentor feedback point to a stable but stretched programme.",
      referencedEntryIds: ["metric-1", "theme-1"],
    },
  ],
  groundingStatus: "PASSED",
  groundingRetryCount: 0,
  curatorModelVersion: "curator-prompt-v1",
  fellBackToSelectionOnly: false,
};

test("build assembles fixed dashboard widgets from catalog and deterministic analytics", () => {
  const dashboard = new AnalyticsDashboardBuilderService().build({
    catalog: makeCatalog(),
    curation: CURATION,
    deterministicAnalyses: [makeDeterministicAnalysis()],
    projectContext: {
      name: "Mentoring Program",
      projectGoal: "Improve youth confidence through mentoring.",
      impactModel: {
        inputs: null,
        activities: null,
        outputs: null,
        outcomes: "Participants sustain mentor relationships.",
        impact: null,
      },
      successIndicators: "Attendance rate; Completion rate",
      targetGroups: ["youth"],
      areaOfOperation: "Berlin",
    },
  });

  assert.deepEqual(
    [...dashboard.availableWidgets.map((widget) => widget.kind)].sort(),
    [
      "category_rank",
      "horizontal_bar",
      "kpi",
      "kpi",
      "line_series",
      "summary",
      "theme_list",
    ],
  );
  assert.deepEqual(
    [...dashboard.defaultLayout.orderedWidgetIds].sort(),
    [...dashboard.availableWidgets.map((widget) => widget.widgetId)].sort(),
  );
  assert.equal(dashboard.schemaVersion, "dashboard-v2");
  assert.equal(dashboard.defaultLayout.hiddenWidgetIds.length, 0);
  assert.equal(
    dashboard.availableWidgets[0]?.goalLinkage.successIndicators.includes(
      "Attendance rate",
    ),
    true,
  );
});
