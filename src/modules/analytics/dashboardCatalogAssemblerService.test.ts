import assert from "node:assert/strict";
import test from "node:test";
import { DashboardCatalogAssemblerService } from "./dashboardCatalogAssemblerService.js";
import {
  createFakeKnowledgeRepositories,
  makeIndicatorEntity,
  makeKnowledgeIndicator,
  makeKnowledgeModel,
  makeThemeEntity,
} from "./analyticsTestFixtures.js";

test("no Project Knowledge Model yet produces an empty catalog", async () => {
  const repos = createFakeKnowledgeRepositories({
    model: null,
    entities: [],
    indicators: [],
  });
  const service = new DashboardCatalogAssemblerService(
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
    repos.datasetPreparationRepository,
    repos.deterministicAnalysisRepository,
  );

  const { catalog, projectKnowledgeModelStatus } = await service.assemble({
    type: "PROJECT",
    projectId: "project-1",
    activityId: null,
  });

  assert.equal(catalog.entries.length, 0);
  assert.equal(projectKnowledgeModelStatus, null);
});

test("a populated indicator and theme become correctly shaped catalog entries", async () => {
  const repos = createFakeKnowledgeRepositories({
    model: makeKnowledgeModel({ version: 3 }),
    entities: [makeIndicatorEntity(), makeThemeEntity()],
    indicators: [makeKnowledgeIndicator()],
  });
  const service = new DashboardCatalogAssemblerService(
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
    repos.datasetPreparationRepository,
    repos.deterministicAnalysisRepository,
  );

  const { catalog, projectKnowledgeModelStatus } = await service.assemble({
    type: "PROJECT",
    projectId: "project-1",
    activityId: null,
  });

  assert.equal(projectKnowledgeModelStatus, "ready");
  assert.equal(catalog.knowledgeModelVersion, 3);
  assert.equal(catalog.entries.length, 2);

  const metric = catalog.entries.find((entry) => entry.entryType === "METRIC");
  assert.ok(metric);
  assert.equal(metric!.label, "Attendance rate");
  if (metric!.entryType === "METRIC") {
    assert.equal(metric!.value, 0.82);
    assert.equal(metric!.deduplicationConfidence, "not_applicable");
  }

  const theme = catalog.entries.find(
    (entry) => entry.entryType === "QUALITATIVE_THEME",
  );
  assert.ok(theme);
  if (theme!.entryType === "QUALITATIVE_THEME") {
    assert.equal(theme!.quoteCount, 1);
    assert.deepEqual(theme!.categories, ["barrier"]);
    assert.deepEqual(theme!.outcomeAnchorTypes, ["project_outcome"]);
  }
  assert.equal(catalog.omittedEntries.length, 0);
  assert.equal(catalog.qualitySignals.length, 0);
});

test("an indicator entity with no computed value is listed as omitted, not silently dropped", async () => {
  const repos = createFakeKnowledgeRepositories({
    model: makeKnowledgeModel(),
    entities: [makeIndicatorEntity()],
    indicators: [], // no KnowledgeIndicator was ever produced for this entity
  });
  const service = new DashboardCatalogAssemblerService(
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
    repos.datasetPreparationRepository,
    repos.deterministicAnalysisRepository,
  );

  const { catalog } = await service.assemble({
    type: "PROJECT",
    projectId: "project-1",
    activityId: null,
  });

  assert.equal(catalog.entries.length, 0);
  assert.equal(catalog.omittedEntries.length, 1);
  assert.equal(
    catalog.omittedEntries[0]!.knowledgeEntityId,
    "entity-indicator-1",
  );
  assert.equal(catalog.qualitySignals.length, 0);
});

test("activity scope excludes indicators and themes belonging to a different activity", async () => {
  const repos = createFakeKnowledgeRepositories({
    model: makeKnowledgeModel(),
    entities: [
      makeIndicatorEntity(),
      makeThemeEntity({
        sourceInstances: [
          {
            uploadMetadataId: "upload-3",
            interpretationResultId: "result-3",
            activityId: "activity-2",
            activityType: "mentoring",
            sourceReference: "Different activity theme",
            addedAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    indicators: [makeKnowledgeIndicator({ activityId: "activity-1" })],
  });
  const service = new DashboardCatalogAssemblerService(
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
    repos.datasetPreparationRepository,
    repos.deterministicAnalysisRepository,
  );

  const { catalog } = await service.assemble({
    type: "ACTIVITY",
    projectId: "project-1",
    activityId: "activity-1",
  });

  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0]!.entryType, "METRIC");
});

test("dataset preparation and deterministic analysis warnings become catalog quality signals", async () => {
  const repos = createFakeKnowledgeRepositories({
    model: makeKnowledgeModel(),
    entities: [makeIndicatorEntity()],
    indicators: [makeKnowledgeIndicator()],
    datasetPreparations: [
      {
        id: "prep-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        privacySafeRepresentationId: "psr-1",
        interpretationResultId: "result-1",
        status: "analysis_completed",
        blockingQuestionCount: 1,
        answeredBlockingQuestionCount: 1,
        unansweredBlockingQuestionIds: [],
        decisions: [],
        decisionSummary: {
          normalizationMerges: [],
          rowGrains: [],
          duplicateIdentifierResolutions: [],
          primaryStatusFields: [],
          positiveStatusDefinitions: [],
          primaryDateFields: [],
        },
        preparedDataset: {
          evidenceModality: "structured_quantitative",
          isReadyForDeterministicAnalysis: true,
          unresolvedRequirements: [
            "Some cohort rows still need manual normalization.",
          ],
          tables: [
            {
              name: "attendance",
              rowCount: 10,
              columnCount: 3,
              selectedRowGrain: "row per participant",
              identifierColumn: "participant_id",
              identifierHandling: "assume_unique",
              primaryStatusColumn: "status",
              primaryDateColumn: "date",
              columns: [],
              notes: [
                "Status values were normalized from mixed language labels.",
              ],
            },
          ],
        },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
    deterministicAnalyses: [
      {
        id: "analysis-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        privacySafeRepresentationId: "psr-1",
        interpretationResultId: "result-1",
        datasetPreparationId: "prep-1",
        status: "ready",
        metrics: [],
        distributions: [],
        trends: [],
        subgroupBreakdowns: [],
        warnings: [
          {
            code: "sparse_denominator",
            message:
              "One subgroup has too few rows for stable ratio interpretation.",
          },
        ],
        candidateIndicators: [],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  });
  const service = new DashboardCatalogAssemblerService(
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
    repos.datasetPreparationRepository,
    repos.deterministicAnalysisRepository,
  );

  const { catalog } = await service.assemble({
    type: "PROJECT",
    projectId: "project-1",
    activityId: null,
  });

  assert.deepEqual(
    catalog.qualitySignals.map((signal) => signal.message),
    [
      "Some cohort rows still need manual normalization.",
      "attendance: Status values were normalized from mixed language labels.",
      "One subgroup has too few rows for stable ratio interpretation.",
    ],
  );
});
