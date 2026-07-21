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
import type { KnowledgeIndicatorRepository } from "./knowledgeIndicatorRepository.js";
import type { KnowledgeIndicatorPersistenceRecord } from "./knowledgeIndicatorPersistence.js";
import { ProjectKnowledgeBuilderService } from "./projectKnowledgeBuilderService.js";

// Shared fake-repository fixtures for exercising
// ProjectKnowledgeBuilderService without a real MongoDB. Used by both the
// unit-level tests in projectKnowledgeBuilderService.test.ts and the
// realistic multi-activity scenario in
// projectKnowledgeBuilderIntegration.test.ts — kept in one place so both
// stay honest about what the fake repositories actually do.

export const NOW = new Date("2026-01-01T00:00:00.000Z");

export function makeActivity(
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

export function makeUpload(
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

export function makeInterpretationResult(
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
    evidenceRouting: null,
    datasetProfile: null,
    entities: [],
    indicators: [],
    relationships: [],
    qualitativeFindings: [],
    supportingQuotes: [],
    questions: [],
    warnings: [],
    goalAlignment: [],
    llmUsage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createFakeRepositories(options: {
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
    status: "stale",
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
      // Mirrors the real Mongo repository's CAS semantics: claiming the
      // lock fails (returns null) if a build is already in progress.
      if (projectKnowledgeModel.status === "building") {
        return null;
      }
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
    deleteMany: async (ids: string[]) => {
      const idSet = new Set(ids);
      let deletedCount = 0;
      for (let index = knowledgeEntities.length - 1; index >= 0; index -= 1) {
        if (idSet.has(knowledgeEntities[index]!.id)) {
          knowledgeEntities.splice(index, 1);
          deletedCount += 1;
        }
      }
      return deletedCount;
    },
  } as unknown as KnowledgeEntityRepository;

  let knowledgeIndicators: KnowledgeIndicatorPersistenceRecord[] = [];

  const knowledgeIndicatorRepository = {
    listByProjectKnowledgeModelId: async () => knowledgeIndicators,
    deleteByProjectKnowledgeModelId: async () => {
      const deletedCount = knowledgeIndicators.length;
      knowledgeIndicators = [];
      return deletedCount;
    },
    create: async (
      input: Parameters<KnowledgeIndicatorRepository["create"]>[0],
    ) => {
      const created: KnowledgeIndicatorPersistenceRecord = {
        id: `indicator-value-${knowledgeIndicators.length + 1}`,
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      };
      knowledgeIndicators.push(created);
      return created;
    },
    createMany: async (
      inputs: Parameters<KnowledgeIndicatorRepository["createMany"]>[0],
    ) => {
      const created = inputs.map((input, index) => ({
        id: `indicator-value-${knowledgeIndicators.length + index + 1}`,
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      }));
      knowledgeIndicators.push(...created);
      return created;
    },
  } as unknown as KnowledgeIndicatorRepository;

  return {
    projectRepository,
    activityRepository,
    uploadMetadataRepository,
    interpretationResultRepository,
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
    knowledgeEntities,
    get knowledgeIndicators() {
      return knowledgeIndicators;
    },
  };
}

export function buildService(repos: ReturnType<typeof createFakeRepositories>) {
  return new ProjectKnowledgeBuilderService(
    repos.projectRepository,
    repos.activityRepository,
    repos.uploadMetadataRepository,
    repos.interpretationResultRepository,
    repos.projectKnowledgeModelRepository,
    repos.knowledgeEntityRepository,
    repos.knowledgeIndicatorRepository,
  );
}
