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
  }
  assert.equal(catalog.omittedEntries.length, 0);
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
  );

  const { catalog } = await service.assemble({
    type: "PROJECT",
    projectId: "project-1",
    activityId: null,
  });

  assert.equal(catalog.entries.length, 0);
  assert.equal(catalog.omittedEntries.length, 1);
  assert.equal(catalog.omittedEntries[0]!.knowledgeEntityId, "entity-indicator-1");
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
  );

  const { catalog } = await service.assemble({
    type: "ACTIVITY",
    projectId: "project-1",
    activityId: "activity-1",
  });

  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0]!.entryType, "METRIC");
});
