import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ActivityPersistenceRecord } from "../activity/activityPersistence.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import type { ProjectKnowledgeModelRepository } from "./projectKnowledgeModelRepository.js";
import type { ProjectKnowledgeModelPersistenceRecord } from "./projectKnowledgeModelPersistence.js";
import type { KnowledgeEntityRepository } from "./knowledgeEntityRepository.js";
import type { KnowledgeEntityPersistenceRecord } from "./knowledgeEntityPersistence.js";
import type { KnowledgeRelationshipRepository } from "./knowledgeRelationshipRepository.js";
import { ProjectKnowledgeBuilderService } from "./projectKnowledgeBuilderService.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeActivity(
  overrides: Partial<ActivityPersistenceRecord>,
): ActivityPersistenceRecord {
  return {
    id: "activity-1",
    projectId: "project-1",
    name: "Activity",
    description: null,
    activityType: "mentoring",
    owner: null,
    startDate: null,
    endDate: null,
    objectives: null,
    successIndicators: null,
    targetAudience: null,
    additionalContext: null,
    status: "active",
    interpretationAcknowledgedAt: NOW,
    interpretationAcknowledgedById: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeUpload(
  overrides: Partial<UploadMetadataPersistenceRecord>,
): UploadMetadataPersistenceRecord {
  return {
    id: "upload-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadedById: "user-1",
    logicalEvidenceId: "evidence-1",
    versionNumber: 1,
    replacesUploadMetadataId: null,
    supersededAt: null,
    originalFileName: "file.csv",
    contentType: "text/csv",
    sizeBytes: 100,
    storageKey: "key",
    originalFileDeletedAt: null,
    status: "uploaded",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeInterpretationResult(
  overrides: Partial<InterpretationResultPersistenceRecord>,
): InterpretationResultPersistenceRecord {
  return {
    id: "result-1",
    organizationId: "org-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    privacySafeRepresentationId: "psr-1",
    processingJobId: "job-1",
    versionNumber: 1,
    previousInterpretationResultId: null,
    datasetType: "attendance_log",
    overallConfidence: 0.9,
    entities: [],
    indicators: [],
    relationships: [],
    qualitativeFindings: [],
    supportingQuotes: [],
    questions: [],
    warnings: [],
    goalAlignment: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createFakeRepositories(options: {
  activities: ActivityPersistenceRecord[];
  uploads: UploadMetadataPersistenceRecord[];
  interpretationResults: InterpretationResultPersistenceRecord[];
  existingEntities?: KnowledgeEntityPersistenceRecord[];
}) {
  const knowledgeEntities: KnowledgeEntityPersistenceRecord[] = [
    ...(options.existingEntities ?? []),
  ];
  let projectKnowledgeModel: ProjectKnowledgeModelPersistenceRecord = {
    id: "pkm-1",
    organizationId: "org-1",
    projectId: "project-1",
    version: 0,
    status: "building",
    createdAt: NOW,
    updatedAt: NOW,
  };

  const projectRepository = {
    findById: async () => ({
      id: "project-1",
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Project",
      projectGoal: null,
      startMonth: null,
      endMonth: null,
      fundingProgram: null,
      fundingOrganization: null,
      targetGroups: [],
      areaOfOperation: null,
      partnerships: null,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as ProjectRepository;

  const activityRepository = {
    listByProject: async () => options.activities,
  } as unknown as ActivityRepository;

  const uploadMetadataRepository = {
    listByActivityIds: async () => options.uploads,
  } as unknown as UploadMetadataRepository;

  const interpretationResultRepository = {
    findLatestByUploadMetadataIds: async () => options.interpretationResults,
  } as unknown as InterpretationResultRepository;

  const projectKnowledgeModelRepository = {
    findOrCreateByProjectId: async () => projectKnowledgeModel,
    markBuilding: async () => {
      projectKnowledgeModel = { ...projectKnowledgeModel, status: "building" };
      return projectKnowledgeModel;
    },
    markReady: async (_projectId: string, version: number) => {
      projectKnowledgeModel = {
        ...projectKnowledgeModel,
        status: "ready",
        version,
      };
      return projectKnowledgeModel;
    },
  } as unknown as ProjectKnowledgeModelRepository;

  const knowledgeEntityRepository = {
    listByProjectKnowledgeModelId: async () => knowledgeEntities,
    create: async (input: {
      projectKnowledgeModelId: string;
      entityType: KnowledgeEntityPersistenceRecord["entityType"];
      canonicalLabel: string;
      description: string;
      attributes: Record<string, unknown>;
      sourceInstances: KnowledgeEntityPersistenceRecord["sourceInstances"];
    }) => {
      const created: KnowledgeEntityPersistenceRecord = {
        id: `entity-${knowledgeEntities.length + 1}`,
        projectKnowledgeModelId: input.projectKnowledgeModelId,
        entityType: input.entityType,
        canonicalLabel: input.canonicalLabel,
        description: input.description,
        attributes: input.attributes,
        sourceInstances: input.sourceInstances,
        createdAt: NOW,
        updatedAt: NOW,
      };
      knowledgeEntities.push(created);
      return created;
    },
    createMany: async (
      inputs: Array<{
        id: string;
        projectKnowledgeModelId: string;
        entityType: KnowledgeEntityPersistenceRecord["entityType"];
        canonicalLabel: string;
        description: string;
        attributes: Record<string, unknown>;
        sourceInstances: KnowledgeEntityPersistenceRecord["sourceInstances"];
      }>,
    ) => {
      const createdEntities = inputs.map((input) => {
        const created: KnowledgeEntityPersistenceRecord = {
          id: input.id,
          projectKnowledgeModelId: input.projectKnowledgeModelId,
          entityType: input.entityType,
          canonicalLabel: input.canonicalLabel,
          description: input.description,
          attributes: input.attributes,
          sourceInstances: input.sourceInstances,
          createdAt: NOW,
          updatedAt: NOW,
        };
        knowledgeEntities.push(created);
        return created;
      });

      return createdEntities;
    },
    addSourceInstance: async (
      knowledgeEntityId: string,
      sourceInstance: KnowledgeEntityPersistenceRecord["sourceInstances"][number],
    ) => {
      const index = knowledgeEntities.findIndex(
        (entity) => entity.id === knowledgeEntityId,
      );
      if (index === -1) {
        return null;
      }
      const updated = {
        ...knowledgeEntities[index],
        sourceInstances: [
          ...knowledgeEntities[index]!.sourceInstances,
          sourceInstance,
        ],
      } as KnowledgeEntityPersistenceRecord;
      knowledgeEntities[index] = updated;
      return updated;
    },
    addSourceInstances: async (
      knowledgeEntityId: string,
      sourceInstances: KnowledgeEntityPersistenceRecord["sourceInstances"],
    ) => {
      const index = knowledgeEntities.findIndex(
        (entity) => entity.id === knowledgeEntityId,
      );
      if (index === -1) {
        return null;
      }
      const updated = {
        ...knowledgeEntities[index],
        sourceInstances: [
          ...knowledgeEntities[index]!.sourceInstances,
          ...sourceInstances,
        ],
      } as KnowledgeEntityPersistenceRecord;
      knowledgeEntities[index] = updated;
      return updated;
    },
    addSourceInstancesMany: async (
      updates: Array<{
        knowledgeEntityId: string;
        sourceInstances: KnowledgeEntityPersistenceRecord["sourceInstances"];
      }>,
    ) => {
      const updatedEntities: KnowledgeEntityPersistenceRecord[] = [];

      for (const update of updates) {
        const index = knowledgeEntities.findIndex(
          (entity) => entity.id === update.knowledgeEntityId,
        );
        if (index === -1 || update.sourceInstances.length === 0) {
          continue;
        }

        const updated = {
          ...knowledgeEntities[index],
          sourceInstances: [
            ...knowledgeEntities[index]!.sourceInstances,
            ...update.sourceInstances,
          ],
        } as KnowledgeEntityPersistenceRecord;
        knowledgeEntities[index] = updated;
        updatedEntities.push(updated);
      }

      return updatedEntities;
    },
    removeSourceInstance: async (
      knowledgeEntityId: string,
      uploadMetadataId: string,
      interpretationResultId: string,
      sourceReference: string,
    ) => {
      const index = knowledgeEntities.findIndex(
        (entity) => entity.id === knowledgeEntityId,
      );
      if (index === -1) {
        return null;
      }
      const updated = {
        ...knowledgeEntities[index],
        sourceInstances: knowledgeEntities[index]!.sourceInstances.filter(
          (instance) =>
            !(
              instance.uploadMetadataId === uploadMetadataId &&
              instance.interpretationResultId === interpretationResultId &&
              instance.sourceReference === sourceReference
            ),
        ),
      } as KnowledgeEntityPersistenceRecord;
      knowledgeEntities[index] = updated;
      return updated;
    },
    removeSourceInstances: async (
      knowledgeEntityId: string,
      staleSourceInstances: Array<{
        uploadMetadataId: string;
        interpretationResultId: string;
        sourceReference: string;
      }>,
    ) => {
      const index = knowledgeEntities.findIndex(
        (entity) => entity.id === knowledgeEntityId,
      );
      if (index === -1) {
        return null;
      }
      const staleKeys = new Set(
        staleSourceInstances.map(
          (instance) =>
            `${instance.uploadMetadataId}::${instance.interpretationResultId}::${instance.sourceReference}`,
        ),
      );
      const updated = {
        ...knowledgeEntities[index],
        sourceInstances: knowledgeEntities[index]!.sourceInstances.filter(
          (instance) =>
            !staleKeys.has(
              `${instance.uploadMetadataId}::${instance.interpretationResultId}::${instance.sourceReference}`,
            ),
        ),
      } as KnowledgeEntityPersistenceRecord;
      knowledgeEntities[index] = updated;
      return updated;
    },
  } as unknown as KnowledgeEntityRepository;

  const relationships: {
    projectKnowledgeModelId: string;
    fromEntityId: string;
    toEntityId: string;
    relationshipType: string;
    confidence: number;
  }[] = [];

  const knowledgeRelationshipRepository = {
    listByProjectKnowledgeModelId: async () =>
      relationships.map((relationship) => ({
        ...relationship,
        id: `${relationship.fromEntityId}-${relationship.toEntityId}-${relationship.relationshipType}`,
        sourceInstances: [],
        createdAt: NOW,
        updatedAt: NOW,
      })),
    findByEntitiesAndType: async (
      projectKnowledgeModelId: string,
      fromEntityId: string,
      toEntityId: string,
      relationshipType: string,
    ) =>
      relationships.find(
        (relationship) =>
          relationship.projectKnowledgeModelId === projectKnowledgeModelId &&
          relationship.fromEntityId === fromEntityId &&
          relationship.toEntityId === toEntityId &&
          relationship.relationshipType === relationshipType,
      ) ?? null,
    create: async (input: {
      projectKnowledgeModelId: string;
      fromEntityId: string;
      toEntityId: string;
      relationshipType: string;
      confidence: number;
    }) => {
      relationships.push(input);
      return input as never;
    },
    createMany: async (
      inputs: Array<{
        id: string;
        projectKnowledgeModelId: string;
        fromEntityId: string;
        toEntityId: string;
        relationshipType: string;
        confidence: number;
      }>,
    ) => {
      relationships.push(...inputs);
      return inputs as never;
    },
  } as unknown as KnowledgeRelationshipRepository;

  return {
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    interpretationResultRepository,
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeRelationshipRepository,
    knowledgeEntities,
    relationships,
  };
}

function buildService(repos: ReturnType<typeof createFakeRepositories>) {
  return new ProjectKnowledgeBuilderService(
    repos.projectRepository,
    repos.activityRepository,
    repos.uploadMetadataRepository,
    repos.interpretationResultRepository,
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeRelationshipRepository,
  );
}

test("Tier 2 exact name+description match merges across two acknowledged activities of the same activityType", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
    makeActivity({ id: "activity-2", activityType: "mentoring" }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-2" }),
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
          status: "kept",
        },
      ],
    }),
    makeInterpretationResult({
      id: "result-2",
      activityId: "activity-2",
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
  assert.equal(indicatorEntities.length, 1);
  assert.equal(indicatorEntities[0]?.sourceInstances.length, 2);
});

test("Tier 2 match does not merge across two different activityTypes despite identical name/description", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
    makeActivity({ id: "activity-2", activityType: "job_training" }),
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
    status: "kept" as const,
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
});

test("a null activityType source does not wildcard-merge every future activityType", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: null }),
    makeActivity({ id: "activity-2", activityType: "mentoring" }),
    makeActivity({ id: "activity-3", activityType: "job_training" }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-2" }),
    makeUpload({ id: "upload-3", activityId: "activity-3" }),
  ];
  const sharedIndicator = {
    name: "Completion rate",
    description: "share of participants who completed the program",
    confidence: 0.9,
    reason: "derived from completion column",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    status: "kept" as const,
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
    makeInterpretationResult({
      id: "result-3",
      activityId: "activity-3",
      uploadMetadataId: "upload-3",
      indicators: [{ ...sharedIndicator, id: "indicator-3" }],
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
  const sourceCounts = indicatorEntities.map(
    (entity) => entity.sourceInstances.length,
  );
  assert.deepEqual(
    sourceCounts.sort((a, b) => a - b),
    [1, 2],
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
  await service.buildForProject("project-1");

  const indicatorEntities = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(indicatorEntities.length, 1);
  assert.equal(indicatorEntities[0]?.sourceInstances.length, 1);
});

test("linking uses resolved merge identity even when labels differ only by case/spacing", async () => {
  const activities = [
    makeActivity({ id: "activity-1", activityType: "mentoring" }),
    makeActivity({ id: "activity-2", activityType: "mentoring" }),
  ];
  const uploads = [
    makeUpload({ id: "upload-1", activityId: "activity-1" }),
    makeUpload({ id: "upload-2", activityId: "activity-2" }),
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
          status: "kept",
        },
      ],
      qualitativeFindings: [
        {
          id: "finding-1",
          summary: "Attendance improved",
          reason: "attendance trended upward over the cohort",
          confidence: 0.8,
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
      activityId: "activity-2",
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
          status: "kept",
        },
      ],
      qualitativeFindings: [
        {
          id: "finding-2",
          summary: "  attendance   improved ",
          reason: "attendance trended upward over the cohort",
          confidence: 0.81,
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

  assert.equal(repos.relationships.length, 1);
  assert.equal(repos.relationships[0]?.relationshipType, "reinforces");
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
          status: "kept",
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

test("an indicator rejected after already contributing to a build is pruned on the next build", async () => {
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
    status: "kept" as const,
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

  const afterSecondBuild = repos.knowledgeEntities.filter(
    (entity) => entity.entityType === "indicator",
  );
  assert.equal(afterSecondBuild.length, 1);
  assert.equal(afterSecondBuild[0]?.sourceInstances.length, 0);
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
