import { databaseSession } from "../../shared/database/databaseClient.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import type {
  KnowledgeEntityType,
  KnowledgeSourceInstance,
} from "../../shared/contracts.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import type { ProjectKnowledgeModelRepository } from "./projectKnowledgeModelRepository.js";
import type { ProjectKnowledgeModelPersistenceRecord } from "./projectKnowledgeModelPersistence.js";
import type { KnowledgeEntityRepository } from "./knowledgeEntityRepository.js";
import type { KnowledgeEntityPersistenceRecord } from "./knowledgeEntityPersistence.js";
import type { KnowledgeRelationshipRepository } from "./knowledgeRelationshipRepository.js";
import type { KnowledgeRelationshipCreateInput } from "./knowledgeRelationshipPersistence.js";

/**
 * Two entity types are matched on name + description agreement (the
 * dominant path today, since InterpretationIndicator/InterpretationEntity
 * carry no dedicated stable ID field). Every other type currently has no
 * reliable natural key either and is therefore never auto-merged in this
 * version — see "Stable Cross-File Identity" in
 * Phase 4 — Project Knowledge Model.md.
 */
const TIER_2_ENTITY_TYPES = new Set<KnowledgeEntityType>([
  "indicator",
  "theme",
]);

/** Jaccard token-overlap threshold for "these two descriptions plausibly
 * describe the same thing" — deterministic, no LLM judgment call. */
const DESCRIPTION_SIMILARITY_THRESHOLD = 0.3;

interface EntityCandidate {
  entityType: KnowledgeEntityType;
  canonicalLabel: string;
  description: string;
  attributes: Record<string, unknown>;
  sourceInstance: KnowledgeSourceInstance;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function descriptionSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeLabel(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeLabel(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionSize += 1;
    }
  }
  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/**
 * Reads verified, acknowledged interpretation data across a project's
 * activities and normalizes it into one canonical Project Knowledge
 * Model. Pure backend logic — no LLM call anywhere in this class. See
 * "Phase 4 — Project Knowledge Model.md" for the full design and the
 * open questions this v1 deliberately defers (cross-file participant
 * identity, human-confirmed merges for ambiguous Tier 2 matches).
 *
 * KnowledgeIndicator (numeric indicator values) is intentionally not
 * populated by this version: InterpretationIndicator today carries a
 * name/description/reason, not a parsed numeric value — inventing one
 * from free text would violate the "never invent values" rule this
 * whole pipeline depends on. The KnowledgeEntity(type=INDICATOR) concept
 * itself is still built and deduplicated; only per-activity numeric
 * values are deferred, until indicator extraction produces a genuine
 * structured value to source from.
 */
export class ProjectKnowledgeBuilderService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeRelationshipRepository: KnowledgeRelationshipRepository,
  ) {}

  async buildForProject(
    projectId: string,
  ): Promise<ProjectKnowledgeModelPersistenceRecord> {
    const project = await this.projectRepository.findById(
      projectId,
      databaseSession,
    );
    if (!project) {
      throw new Error(`Project ${projectId} was not found.`);
    }

    const projectKnowledgeModel =
      await this.projectKnowledgeModelRepository.findOrCreateByProjectId(
        { organizationId: project.organizationId, projectId },
        databaseSession,
      );
    await this.projectKnowledgeModelRepository.markBuilding(
      projectId,
      databaseSession,
    );

    const activities = await this.activityRepository.listByProject(
      projectId,
      databaseSession,
    );
    const acknowledgedActivities = activities.filter(
      (activity) => activity.interpretationAcknowledgedAt !== null,
    );
    const activityTypeById = new Map(
      acknowledgedActivities.map((activity) => [
        activity.id,
        activity.activityType,
      ]),
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      acknowledgedActivities.map((activity) => activity.id),
      databaseSession,
    );
    const interpretationResults =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    const candidates = interpretationResults.flatMap((result) =>
      this.normalize(result, activityTypeById),
    );

    const existingEntities =
      await this.knowledgeEntityRepository.listByProjectKnowledgeModelId(
        projectKnowledgeModel.id,
        databaseSession,
      );
    await this.pruneStaleSourceInstances(
      existingEntities,
      interpretationResults,
      candidates,
    );

    const entitiesByType = new Map<
      KnowledgeEntityType,
      KnowledgeEntityPersistenceRecord[]
    >();
    const candidateEntityIdByKey = new Map<string, string>();
    const pendingSourceInstanceMerges = new Map<
      string,
      KnowledgeSourceInstance[]
    >();
    const pendingEntityCreates: Array<{
      id: string;
      entityType: KnowledgeEntityType;
      canonicalLabel: string;
      description: string;
      attributes: Record<string, unknown>;
      sourceInstances: KnowledgeSourceInstance[];
    }> = [];
    for (const entity of existingEntities) {
      const bucket = entitiesByType.get(entity.entityType) ?? [];
      bucket.push(entity);
      entitiesByType.set(entity.entityType, bucket);
    }

    for (const candidate of candidates) {
      await this.deduplicateAndMerge(
        projectKnowledgeModel.id,
        candidate,
        entitiesByType,
        candidateEntityIdByKey,
        pendingSourceInstanceMerges,
        pendingEntityCreates,
      );
    }

    await this.flushPendingEntityCreates(
      projectKnowledgeModel.id,
      pendingEntityCreates,
    );

    await this.flushPendingSourceInstanceMerges(
      entitiesByType,
      pendingSourceInstanceMerges,
    );

    await this.link(
      projectKnowledgeModel.id,
      interpretationResults,
      entitiesByType,
      candidateEntityIdByKey,
    );

    const nextVersion = projectKnowledgeModel.version + 1;
    const readyModel = await this.projectKnowledgeModelRepository.markReady(
      projectId,
      nextVersion,
      databaseSession,
    );
    return readyModel as ProjectKnowledgeModelPersistenceRecord;
  }

  /** Normalize: map one interpretation result's kept indicators/entities
   * into candidate KnowledgeEntity shapes. No matching decisions here. */
  private normalize(
    result: InterpretationResultPersistenceRecord,
    activityTypeById: Map<string, string | null>,
  ): EntityCandidate[] {
    if (!result.activityId || !activityTypeById.has(result.activityId)) {
      // Not on an acknowledged activity (or no activity at all) — the
      // Knowledge Builder only ever reads verified data.
      return [];
    }
    const activityType = activityTypeById.get(result.activityId) ?? null;

    const candidates: EntityCandidate[] = [];

    for (const indicator of result.indicators) {
      if (indicator.status !== "kept") {
        continue;
      }
      candidates.push({
        entityType: "indicator",
        canonicalLabel: indicator.name,
        description: indicator.description,
        attributes: { reason: indicator.reason },
        sourceInstance: {
          uploadMetadataId: result.uploadMetadataId,
          interpretationResultId: result.id,
          activityId: result.activityId,
          activityType,
          sourceReference: indicator.name,
          addedAt: new Date().toISOString(),
        },
      });
    }

    for (const finding of result.qualitativeFindings) {
      if (finding.status !== "kept") {
        continue;
      }
      candidates.push({
        entityType: "theme",
        canonicalLabel: finding.summary,
        description: finding.reason,
        attributes: { stage: finding.stage },
        sourceInstance: {
          uploadMetadataId: result.uploadMetadataId,
          interpretationResultId: result.id,
          activityId: result.activityId,
          activityType,
          sourceReference: finding.summary,
          addedAt: new Date().toISOString(),
        },
      });
    }

    return candidates;
  }

  /**
   * Removes source instances that no longer represent verified, kept
   * data: either the interpretation result they came from is no longer
   * the latest/acknowledged one for its activity (superseded or the
   * activity was un-acknowledged), or that specific item is still on the
   * latest result but is no longer kept (e.g. an indicator that was
   * rejected after already contributing to a prior build). This is what
   * makes a rejection actually take effect on the next build, rather
   * than a stale merge lingering forever. Mutates `existingEntities` in
   * place so the caller's subsequent matching sees the pruned state.
   */
  private async pruneStaleSourceInstances(
    existingEntities: KnowledgeEntityPersistenceRecord[],
    currentInterpretationResults: InterpretationResultPersistenceRecord[],
    currentCandidates: EntityCandidate[],
  ): Promise<void> {
    const validInterpretationResultIds = new Set(
      currentInterpretationResults.map((result) => result.id),
    );
    const validCandidateKeys = new Set(
      currentCandidates.map(
        (candidate) =>
          `${candidate.sourceInstance.interpretationResultId}::${candidate.sourceInstance.sourceReference}`,
      ),
    );

    for (const [index, entity] of existingEntities.entries()) {
      const staleInstances = entity.sourceInstances.filter((instance) => {
        if (
          !validInterpretationResultIds.has(instance.interpretationResultId)
        ) {
          return true;
        }
        const key = `${instance.interpretationResultId}::${instance.sourceReference}`;
        return !validCandidateKeys.has(key);
      });

      let updated: KnowledgeEntityPersistenceRecord | null = entity;
      if (staleInstances.length > 0) {
        updated = await this.knowledgeEntityRepository.removeSourceInstances(
          entity.id,
          staleInstances.map((stale) => ({
            uploadMetadataId: stale.uploadMetadataId,
            interpretationResultId: stale.interpretationResultId,
            sourceReference: stale.sourceReference,
          })),
          databaseSession,
        );
      }
      if (updated) {
        existingEntities[index] = updated;
      }
    }
  }

  /** Deduplicate + Merge: match a candidate against already-known entities
   * of the same type using the risk-tiered strategy, or create a new
   * entity when nothing matches. */
  private async deduplicateAndMerge(
    projectKnowledgeModelId: string,
    candidate: EntityCandidate,
    entitiesByType: Map<
      KnowledgeEntityType,
      KnowledgeEntityPersistenceRecord[]
    >,
    candidateEntityIdByKey: Map<string, string>,
    pendingSourceInstanceMerges: Map<string, KnowledgeSourceInstance[]>,
    pendingEntityCreates: Array<{
      id: string;
      entityType: KnowledgeEntityType;
      canonicalLabel: string;
      description: string;
      attributes: Record<string, unknown>;
      sourceInstances: KnowledgeSourceInstance[];
    }>,
  ): Promise<void> {
    const existingOfType = entitiesByType.get(candidate.entityType) ?? [];

    if (TIER_2_ENTITY_TYPES.has(candidate.entityType)) {
      const normalizedCandidateLabel = normalizeLabel(candidate.canonicalLabel);
      const match = existingOfType.find(
        (entity) =>
          normalizeLabel(entity.canonicalLabel) === normalizedCandidateLabel &&
          descriptionSimilarity(entity.description, candidate.description) >=
            DESCRIPTION_SIMILARITY_THRESHOLD &&
          this.hasCompatibleActivityType(entity, candidate.sourceInstance),
      );

      if (match) {
        const alreadyRecorded = match.sourceInstances.some(
          (instance) =>
            instance.uploadMetadataId ===
              candidate.sourceInstance.uploadMetadataId &&
            instance.interpretationResultId ===
              candidate.sourceInstance.interpretationResultId &&
            instance.sourceReference ===
              candidate.sourceInstance.sourceReference,
        );

        let resolvedEntity = match;
        if (!alreadyRecorded) {
          const mergedEntity = {
            ...match,
            sourceInstances: [
              ...match.sourceInstances,
              candidate.sourceInstance,
            ],
          };
          this.replaceInBucket(existingOfType, mergedEntity);
          resolvedEntity = mergedEntity;

          const pending = pendingSourceInstanceMerges.get(match.id) ?? [];
          pending.push(candidate.sourceInstance);
          pendingSourceInstanceMerges.set(match.id, pending);
        }

        candidateEntityIdByKey.set(
          this.getCandidateKey(
            candidate.sourceInstance.interpretationResultId,
            candidate.sourceInstance.sourceReference,
          ),
          resolvedEntity.id,
        );
        return;
      }
    }

    // Tier 1 (stable-key) and Participant/Mentor auto-matching are both
    // intentionally not exercised in this version — see the class-level
    // doc comment. Every other candidate becomes its own new entity.
    const created: KnowledgeEntityPersistenceRecord = {
      id: createDocumentId(),
      projectKnowledgeModelId,
      entityType: candidate.entityType,
      canonicalLabel: candidate.canonicalLabel,
      description: candidate.description,
      attributes: candidate.attributes,
      sourceInstances: [candidate.sourceInstance],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    pendingEntityCreates.push({
      id: created.id,
      entityType: created.entityType,
      canonicalLabel: created.canonicalLabel,
      description: created.description,
      attributes: created.attributes,
      sourceInstances: created.sourceInstances,
    });
    existingOfType.push(created);
    entitiesByType.set(candidate.entityType, existingOfType);
    candidateEntityIdByKey.set(
      this.getCandidateKey(
        candidate.sourceInstance.interpretationResultId,
        candidate.sourceInstance.sourceReference,
      ),
      created.id,
    );
  }

  private async flushPendingEntityCreates(
    projectKnowledgeModelId: string,
    pendingEntityCreates: Array<{
      id: string;
      entityType: KnowledgeEntityType;
      canonicalLabel: string;
      description: string;
      attributes: Record<string, unknown>;
      sourceInstances: KnowledgeSourceInstance[];
    }>,
  ): Promise<void> {
    if (pendingEntityCreates.length === 0) {
      return;
    }

    await this.knowledgeEntityRepository.createMany(
      pendingEntityCreates.map((entity) => ({
        id: entity.id,
        projectKnowledgeModelId,
        entityType: entity.entityType,
        canonicalLabel: entity.canonicalLabel,
        description: entity.description,
        attributes: entity.attributes,
        sourceInstances: entity.sourceInstances,
      })),
      databaseSession,
    );
  }

  /** Tier 2 matches never merge across two different activityTypes, even
   * with an exact name + description match — a false merge across
   * unrelated program types is worse than a missed one. */
  private hasCompatibleActivityType(
    entity: KnowledgeEntityPersistenceRecord,
    candidateInstance: KnowledgeSourceInstance,
  ): boolean {
    const knownRealActivityTypes = new Set(
      entity.sourceInstances
        .map((instance) => instance.activityType)
        .filter((type): type is string => type !== null),
    );

    if (
      knownRealActivityTypes.size === 0 ||
      candidateInstance.activityType === null
    ) {
      return true;
    }

    return knownRealActivityTypes.has(candidateInstance.activityType);
  }

  private getCandidateKey(
    interpretationResultId: string,
    sourceReference: string,
  ): string {
    return `${interpretationResultId}::${sourceReference}`;
  }

  private async flushPendingSourceInstanceMerges(
    entitiesByType: Map<
      KnowledgeEntityType,
      KnowledgeEntityPersistenceRecord[]
    >,
    pendingSourceInstanceMerges: Map<string, KnowledgeSourceInstance[]>,
  ): Promise<void> {
    const updatedEntities =
      await this.knowledgeEntityRepository.addSourceInstancesMany(
        [...pendingSourceInstanceMerges.entries()].map(
          ([knowledgeEntityId, sourceInstances]) => ({
            knowledgeEntityId,
            sourceInstances,
          }),
        ),
        databaseSession,
      );

    for (const updated of updatedEntities) {
      for (const bucket of entitiesByType.values()) {
        this.replaceInBucket(bucket, updated);
      }
    }
  }

  private replaceInBucket(
    bucket: KnowledgeEntityPersistenceRecord[],
    updated: KnowledgeEntityPersistenceRecord,
  ): void {
    const index = bucket.findIndex((entity) => entity.id === updated.id);
    if (index >= 0) {
      bucket[index] = updated;
    }
  }

  /** Link: map already-asserted relations (a qualitative finding's
   * relationToEvidence) into project-scoped KnowledgeRelationship
   * records. No new reasoning — purely restating an existing, verified
   * link at a larger scope. */
  private async link(
    projectKnowledgeModelId: string,
    interpretationResults: InterpretationResultPersistenceRecord[],
    entitiesByType: Map<
      KnowledgeEntityType,
      KnowledgeEntityPersistenceRecord[]
    >,
    candidateEntityIdByKey: Map<string, string>,
  ): Promise<void> {
    const themeEntities = entitiesByType.get("theme") ?? [];
    const indicatorEntities = entitiesByType.get("indicator") ?? [];
    const existingRelationships =
      await this.knowledgeRelationshipRepository.listByProjectKnowledgeModelId(
        projectKnowledgeModelId,
        databaseSession,
      );
    const relationshipKeySet = new Set(
      existingRelationships.map((relationship) =>
        this.getRelationshipKey(
          relationship.fromEntityId,
          relationship.toEntityId,
          relationship.relationshipType,
        ),
      ),
    );
    const pendingRelationshipCreates: Array<
      KnowledgeRelationshipCreateInput & { id: string }
    > = [];

    for (const result of interpretationResults) {
      for (const finding of result.qualitativeFindings) {
        if (
          finding.status !== "kept" ||
          finding.relationToEvidence === "context_only" ||
          finding.relatedIndicatorIds.length === 0
        ) {
          continue;
        }

        const themeEntityId = candidateEntityIdByKey.get(
          this.getCandidateKey(result.id, finding.summary),
        );
        const themeEntity = themeEntityId
          ? themeEntities.find((entity) => entity.id === themeEntityId)
          : undefined;
        if (!themeEntity) {
          continue;
        }

        const relatedIndicator = result.indicators.find((indicator) =>
          finding.relatedIndicatorIds.includes(indicator.id),
        );
        const indicatorEntityId = relatedIndicator
          ? candidateEntityIdByKey.get(
              this.getCandidateKey(result.id, relatedIndicator.name),
            )
          : undefined;
        const indicatorEntity = indicatorEntityId
          ? indicatorEntities.find((entity) => entity.id === indicatorEntityId)
          : undefined;
        if (!indicatorEntity) {
          continue;
        }

        const relationshipKey = this.getRelationshipKey(
          themeEntity.id,
          indicatorEntity.id,
          finding.relationToEvidence,
        );
        if (relationshipKeySet.has(relationshipKey)) {
          continue;
        }

        pendingRelationshipCreates.push({
          id: createDocumentId(),
          projectKnowledgeModelId,
          fromEntityId: themeEntity.id,
          toEntityId: indicatorEntity.id,
          relationshipType: finding.relationToEvidence,
          confidence: finding.confidence,
          sourceInstances: [
            {
              uploadMetadataId: result.uploadMetadataId,
              interpretationResultId: result.id,
              activityId: result.activityId ?? "",
              activityType: null,
              sourceReference: finding.summary,
              addedAt: new Date().toISOString(),
            },
          ],
        });
        relationshipKeySet.add(relationshipKey);
      }
    }

    await this.knowledgeRelationshipRepository.createMany(
      pendingRelationshipCreates,
      databaseSession,
    );
  }

  private getRelationshipKey(
    fromEntityId: string,
    toEntityId: string,
    relationshipType: string,
  ): string {
    return `${fromEntityId}::${toEntityId}::${relationshipType}`;
  }
}
