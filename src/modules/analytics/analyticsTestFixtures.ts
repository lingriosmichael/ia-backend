import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { ProjectPersistenceRecord } from "../project/projectPersistence.js";
import type { KnowledgeEntityPersistenceRecord } from "../knowledge/knowledgeEntityPersistence.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeIndicatorPersistenceRecord } from "../knowledge/knowledgeIndicatorPersistence.js";
import type { KnowledgeIndicatorRepository } from "../knowledge/knowledgeIndicatorRepository.js";
import type { ProjectKnowledgeModelPersistenceRecord } from "../knowledge/projectKnowledgeModelPersistence.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DeterministicAnalysisPersistenceRecord } from "../interpretation/deterministicAnalysisPersistence.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";

// Shared fake-dependency fixtures for exercising the analytics module's
// services without a real MongoDB or a real Python service call — mirrors
// the pattern already used by knowledgeBuilderTestFixtures.ts and
// authorizationService.test.ts.

export const NOW = new Date("2026-01-01T00:00:00.000Z");

export function makeProject(
  overrides: Partial<ProjectPersistenceRecord> = {},
): ProjectPersistenceRecord {
  return {
    id: "project-1",
    organizationId: "org-1",
    ownerId: "user-1",
    name: "Mentoring Program",
    projectGoal: "Improve youth confidence through mentoring.",
    startMonth: null,
    endMonth: null,
    fundingProgram: null,
    fundingOrganization: null,
    targetGroups: ["youth"],
    areaOfOperation: "Berlin",
    partnerships: null,
    sdgs: [],
    impactModel: {
      inputs: null,
      activities: null,
      outputs: null,
      impact: null,
      outcomes: null,
    },
    successIndicators: null,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ProjectPersistenceRecord;
}

export function makeKnowledgeModel(
  overrides: Partial<ProjectKnowledgeModelPersistenceRecord> = {},
): ProjectKnowledgeModelPersistenceRecord {
  return {
    id: "pkm-1",
    organizationId: "org-1",
    projectId: "project-1",
    version: 1,
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeIndicatorEntity(
  overrides: Partial<KnowledgeEntityPersistenceRecord> = {},
): KnowledgeEntityPersistenceRecord {
  return {
    id: "entity-indicator-1",
    projectKnowledgeModelId: "pkm-1",
    entityType: "indicator",
    canonicalLabel: "Attendance rate",
    description: "Share of sessions attended.",
    attributes: {},
    sourceInstances: [
      {
        uploadMetadataId: "upload-1",
        interpretationResultId: "result-1",
        activityId: "activity-1",
        activityType: "mentoring",
        sourceReference: "Attendance rate",
        addedAt: NOW.toISOString(),
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeThemeEntity(
  overrides: Partial<KnowledgeEntityPersistenceRecord> = {},
): KnowledgeEntityPersistenceRecord {
  return {
    id: "entity-theme-1",
    projectKnowledgeModelId: "pkm-1",
    entityType: "theme",
    canonicalLabel: "Mentors reporting insufficient support",
    description: "Recurring theme in interviews.",
    attributes: {},
    sourceInstances: [
      {
        uploadMetadataId: "upload-2",
        interpretationResultId: "result-2",
        activityId: "activity-1",
        activityType: "mentoring",
        sourceReference: "Mentors reporting insufficient support",
        addedAt: NOW.toISOString(),
        qualitativeContext: {
          category: "barrier",
          outcomeReference: "Participants sustain mentor relationships.",
          outcomeAnchorType: "project_outcome",
          relationToEvidence: "context_only",
        },
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeKnowledgeIndicator(
  overrides: Partial<KnowledgeIndicatorPersistenceRecord> = {},
): KnowledgeIndicatorPersistenceRecord {
  return {
    id: "indicator-value-1",
    projectKnowledgeModelId: "pkm-1",
    knowledgeEntityId: "entity-indicator-1",
    value: 0.82,
    unit: "ratio",
    activityId: "activity-1",
    participantId: null,
    sourceEvidence: {
      uploadMetadataId: "upload-1",
      interpretationResultId: "result-1",
      sourceReference: "Attendance rate",
    },
    confidence: 0.9,
    deduplicationConfidence: "not_applicable",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createFakeAuthorization(
  project: ProjectPersistenceRecord,
  activityByIdMap: Map<string, { id: string; projectId: string }> = new Map(),
): AuthorizationService {
  const organizationRepository = {
    findMembership: async () => ({
      id: "membership-1",
      userId: "user-1",
      organizationId: project.organizationId,
      role: "ORGANIZATION_ADMIN",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  } as unknown as OrganizationRepository;

  const projectRepository = {
    findById: async () => project,
  } as unknown as ProjectRepository;

  const activityRepository = {
    findById: async (activityId: string) => activityByIdMap.get(activityId) ?? null,
  } as unknown as ActivityRepository;

  return new AuthorizationService(
    organizationRepository,
    projectRepository,
    activityRepository,
  );
}

export function createFakeKnowledgeRepositories(options: {
  model: ProjectKnowledgeModelPersistenceRecord | null;
  entities: KnowledgeEntityPersistenceRecord[];
  indicators: KnowledgeIndicatorPersistenceRecord[];
  datasetPreparations?: DatasetPreparationPersistenceRecord[];
  deterministicAnalyses?: DeterministicAnalysisPersistenceRecord[];
}) {
  const projectKnowledgeModelRepository = {
    findByProjectId: async () => options.model,
  } as unknown as ProjectKnowledgeModelRepository;

  const knowledgeEntityRepository = {
    listByProjectKnowledgeModelId: async () => options.entities,
  } as unknown as KnowledgeEntityRepository;

  const knowledgeIndicatorRepository = {
    listByProjectKnowledgeModelId: async () => options.indicators,
  } as unknown as KnowledgeIndicatorRepository;

  const datasetPreparationRepository = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      (options.datasetPreparations ?? []).filter((record) =>
        interpretationResultIds.includes(record.interpretationResultId),
      ),
  } as unknown as DatasetPreparationRepository;

  const deterministicAnalysisRepository = {
    findByInterpretationResultIds: async (interpretationResultIds: string[]) =>
      (options.deterministicAnalyses ?? []).filter((record) =>
        interpretationResultIds.includes(record.interpretationResultId),
      ),
  } as unknown as DeterministicAnalysisRepository;

  return {
    projectKnowledgeModelRepository,
    knowledgeEntityRepository,
    knowledgeIndicatorRepository,
    datasetPreparationRepository,
    deterministicAnalysisRepository,
  };
}
