import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { KnowledgeEntityPersistenceRecord } from "./knowledgeEntityPersistence.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import {
  NOW,
  buildService,
  createFakeRepositories,
  makeActivity,
  makeInterpretationResult,
  makeUpload,
} from "./knowledgeBuilderTestFixtures.js";

test("Tier 2 exact name+description match merges across two files within the same activity", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-1" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-1",
          name: "Program completion rate",
          description: "share of participants who completed the program",
          confidence: 0.9,
          reason: "derived from completion column",
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
    makeInterpretationResult({
      id: "result-2",
      activityId: "activity-1",
      uploadMetadataId: "upload-2",
      indicators: [
        {
          id: "indicator-2",
          name: "program completion rate",
          description: "share of participants who completed the program",
          confidence: 0.85,
          reason: "derived from completion column",
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

  const indicatorEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(indicatorEntities.length, 1);
  assert.equal(indicatorEntities[0]?.sourceInstances.length, 2);
});

test("Tier 2 match never merges across two different activities, even with identical name/description and the same activityType", async () => {
  // This is the exact case a false merge would be wrong for: two
  // deliberately distinct activities in the same mentoring program,
  // each tracking their own "completion rate" for their own purposes.
  // Similar wording does not mean it's the same underlying metric —
  // that judgment is deferred to an explicit, human-confirmed
  // cross-activity link, never decided by text similarity alone.
  const activities = [
    makeActivity({
      id: "activity-1",
      activityType: "mentoring",
      name: "Mentor:innengewinnung, Auswahl und Schulung",
    }),
    makeActivity({
      id: "activity-2",
      activityType: "mentoring",
      name: "Mentor:innenschulung",
    }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-2" }),
  ];
  const sharedIndicator = {
    name: "Completion rate",
    description: "share of participants who completed the program",
    confidence: 0.9,
    reason: "derived from completion column",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept" as const,
    suggestedCalculation: null,
    computedValue: null,
  };
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [{ ...sharedIndicator, id: "indicator-1" }],
    }),
    makeInterpretationResult({
      id: "result-2",
      activityId: "activity-2",
      uploadMetadataId: "upload-2",
      indicators: [{ ...sharedIndicator, id: "indicator-2" }],
    }),
  ];

  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults,
  });
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const indicatorEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(indicatorEntities.length, 2);
  assert.deepEqual(
    indicatorEntities.map((entity) => entity.sourceInstances.length),
    [1, 1],
  );
});

test("rebuilding with unchanged input is idempotent for sourceInstances", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [makeUpload({ id: "upload-1", activityId: "activity-1" })];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-1",
          name: "Program completion rate",
          description: "share of participants who completed the program",
          confidence: 0.9,
          reason: "derived from completion column",
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
  await service.buildForProject("project-1");

  const indicatorEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(indicatorEntities.length, 1);
  assert.equal(indicatorEntities[0]?.sourceInstances.length, 1);
});

test("theme and indicator entities both merge when labels differ only by case/spacing within one activity", async () => {
  // Both results are on the same activity (two of its own files) — Tier 2
  // merging only ever happens within one activity, so this is the
  // realistic scenario for exercising normalization + merge together.
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-1" }),
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-1",
          name: "Completion Rate",
          description: "share of participants who completed the program",
          confidence: 0.92,
          reason: "derived from completion column",
          relatedEntityIds: [],
          supportingParagraphKeys: [],
          relevanceStage: null,
          matchesStatedGoal: false,
          status: "kept",
          suggestedCalculation: null,
          computedValue: null,
        },
      ],
      qualitativeFindings: [
        {
          id: "finding-1",
          summary: "Attendance improved",
          reason: "attendance trended upward over the cohort",
          confidence: 0.8,
          category: "context_only",
          outcomeReference: null,
          outcomeAnchorType: "unanchored",
          relationToEvidence: "context_only",
          stage: "outcome",
          relatedEntityIds: [],
          relatedIndicatorIds: [],
          supportingQuoteIds: [],
          status: "kept",
        },
      ],
    }),
    makeInterpretationResult({
      id: "result-2",
      activityId: "activity-1",
      uploadMetadataId: "upload-2",
      indicators: [
        {
          id: "indicator-2",
          name: "  completion rate  ",
          description: "share of participants who completed the program",
          confidence: 0.9,
          reason: "derived from completion column",
          relatedEntityIds: [],
          supportingParagraphKeys: [],
          relevanceStage: null,
          matchesStatedGoal: false,
          status: "kept",
          suggestedCalculation: null,
          computedValue: null,
        },
      ],
      qualitativeFindings: [
        {
          id: "finding-2",
          summary: "  attendance   improved ",
          reason: "attendance trended upward over the cohort",
          confidence: 0.81,
          category: "context_only",
          outcomeReference: null,
          outcomeAnchorType: "unanchored",
          relationToEvidence: "reinforces",
          stage: "outcome",
          relatedEntityIds: [],
          relatedIndicatorIds: ["indicator-2"],
          supportingQuoteIds: [],
          status: "kept",
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

  const indicatorEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  const themeEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "theme",
  );
  assert.equal(indicatorEntities.length, 1);
  assert.equal(indicatorEntities[0]?.sourceInstances.length, 2);
  assert.equal(themeEntities.length, 1);
  assert.equal(themeEntities[0]?.sourceInstances.length, 2);
});

test("pruneStaleSourceInstances removes only the stale sourceReference", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [makeUpload({ id: "upload-1", activityId: "activity-1" })];
  const existingEntities: KnowledgeEntityPersistenceRecord[] = [
    {
      id: "entity-1",
      projectKnowledgeModelId: "pkm-1",
      entityType: "indicator",
      canonicalLabel: "Indicator B",
      description: "shared description",
      attributes: {},
      sourceInstances: [
        {
          uploadMetadataId: "upload-1",
          interpretationResultId: "result-1",
          activityId: "activity-1",
          activityType: "mentoring",
          sourceReference: "Indicator A",
          addedAt: NOW.toISOString(),
        },
        {
          uploadMetadataId: "upload-1",
          interpretationResultId: "result-1",
          activityId: "activity-1",
          activityType: "mentoring",
          sourceReference: "Indicator B",
          addedAt: NOW.toISOString(),
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-2",
          name: "Indicator B",
          description: "shared description",
          confidence: 0.9,
          reason: "derived from completion column",
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
    existingEntities,
  });
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const indicatorEntity = repos.knowledgeEntities.find(
    (entity) => entity.id === "entity-1",
  );
  assert.ok(indicatorEntity);
  assert.equal(indicatorEntity.sourceInstances.length, 1);
  assert.equal(
    indicatorEntity.sourceInstances[0]?.sourceReference,
    "Indicator B",
  );
});

test("an entity emptied of all source instances is deleted, not left as an orphan", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [makeUpload({ id: "upload-1", activityId: "activity-1" })];
  const keptIndicator = {
    id: "indicator-1",
    name: "Program completion rate",
    description: "share of participants who completed the program",
    confidence: 0.9,
    reason: "derived from completion column",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept" as const,
    suggestedCalculation: null,
    computedValue: null,
  };

  const firstBuildResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [keptIndicator],
    }),
  ];
  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults: firstBuildResults,
  });
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const afterFirstBuild = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(afterFirstBuild.length, 1);
  assert.equal(afterFirstBuild[0]?.sourceInstances.length, 1);

  // Same result id, but the indicator is now rejected — the repository
  // fake always returns whatever the test wires up, so re-point it at a
  // second-build fixture reflecting the curation change.
  repos.interpretationResultRepository.findLatestByUploadMetadataIds =
    (async () => [
      makeInterpretationResult({
        id: "result-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        indicators: [{ ...keptIndicator, status: "rejected" }],
      }),
    ]) as InterpretationResultRepository["findLatestByUploadMetadataIds"];

  await service.buildForProject("project-1");

  // The entity's only source instance is gone — it must be deleted
  // outright, not left behind with an empty sourceInstances array. An
  // empty-provenance entity would both violate "every entity traces to
  // real evidence" and become a wildcard match for any future candidate
  // of the same type (hasCompatibleActivity treats zero known activities
  // as "compatible with anything").
  const afterSecondBuild = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(afterSecondBuild.length, 0);
});

test("deleting an activity's only evidence cascade-deletes the orphaned entities", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
  ];
  const uploads = [makeUpload({ id: "upload-1", activityId: "activity-1" })];
  const firstBuildResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-1",
          name: "Completion rate",
          description: "share of participants who completed the program",
          confidence: 0.9,
          reason: "derived from completion column",
          relatedEntityIds: [],
          supportingParagraphKeys: [],
          relevanceStage: null,
          matchesStatedGoal: false,
          status: "kept",
          suggestedCalculation: null,
          computedValue: null,
        },
      ],
      qualitativeFindings: [
        {
          id: "finding-1",
          summary: "Attendance improved",
          reason: "attendance trended upward over the cohort",
          confidence: 0.8,
          category: "context_only",
          outcomeReference: null,
          outcomeAnchorType: "unanchored",
          relationToEvidence: "reinforces",
          stage: "outcome",
          relatedEntityIds: [],
          relatedIndicatorIds: ["indicator-1"],
          supportingQuoteIds: [],
          status: "kept",
        },
      ],
    }),
  ];

  const repos = createFakeRepositories({
    activities,
    uploads,
    interpretationResults: firstBuildResults,
  });
  const service = buildService(repos);
  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeEntities.length, 2);

  // The activity (and therefore its upload/evidence) is gone on the next
  // build — modeling both an evidence deletion and an activity deletion,
  // which look identical to the builder: the activity/upload simply no
  // longer appears in what the repositories return.
  repos.activityRepository.listByProject =
    (async () => []) as ActivityRepository["listByProject"];
  repos.uploadMetadataRepository.listByActivityIds =
    (async () => []) as UploadMetadataRepository["listByActivityIds"];
  repos.interpretationResultRepository.findLatestByUploadMetadataIds =
    (async () => []) as InterpretationResultRepository["findLatestByUploadMetadataIds"];

  await service.buildForProject("project-1");

  assert.equal(
    repos.knowledgeEntities.length,
    0,
    "both the indicator and theme entities should be deleted, not left as empty orphans",
  );
});

test("unacknowledged activities are skipped entirely", async () => {
  const activities = [
    makeActivity({ id: "activity-1", interpretationAcknowledgedAt: null }),
  ];
  const uploads = [makeUpload({ id: "upload-1", activityId: "activity-1" })];
  const interpretationResults = [
    makeInterpretationResult({
      id: "result-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      indicators: [
        {
          id: "indicator-1",
          name: "Program completion rate",
          description: "share of participants who completed the program",
          confidence: 0.9,
          reason: "derived from completion column",
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

  assert.equal(repos.knowledgeEntities.length, 0);
});

test("the Knowledge Builder module never imports an AI/LLM client", () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(currentDirectory, "projectKnowledgeBuilderService.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /openai|pythonProcessingClient|OpenAI/i);
});
