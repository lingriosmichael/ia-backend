import { databaseSession } from "../../shared/database/databaseClient.js";
import type { ProjectRepository } from "../project/projectRepository.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import type {
  IndicatorCalculationOperation,
  KnowledgeEntityType,
  KnowledgeIndicatorDeduplicationConfidence,
  KnowledgeSourceInstance,
} from "../../shared/contracts.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import type { ProjectKnowledgeModelRepository } from "./projectKnowledgeModelRepository.js";
import type { ProjectKnowledgeModelPersistenceRecord } from "./projectKnowledgeModelPersistence.js";
import type { KnowledgeEntityRepository } from "./knowledgeEntityRepository.js";
import type { KnowledgeEntityPersistenceRecord } from "./knowledgeEntityPersistence.js";
import type { KnowledgeIndicatorRepository } from "./knowledgeIndicatorRepository.js";
import type { KnowledgeIndicatorCreateInput } from "./knowledgeIndicatorPersistence.js";

/**
 * Two entity types are matched on name + description agreement (the
 * dominant path today, since InterpretationIndicator/InterpretationEntity
 * carry no dedicated stable ID field). Every other type currently has no
 * reliable natural key either and is therefore never auto-merged in this
 * version — see "Stable Cross-File Identity" in
 * Phase 4 — Project Knowledge Model.md.
 *
 * This matching is scoped to a single activity by default — see
 * hasCompatibleActivity below. Two different activities in the same
 * project never merge automatically here, even with identical wording;
 * cross-activity unification is a deliberately separate, human-confirmed
 * concern, not something text similarity alone should decide.
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
 * KnowledgeIndicator (numeric indicator values) is populated from each
 * kept InterpretationIndicator's `computedValue` — itself produced
 * deterministically in ia_python_service (never LLM arithmetic; see
 * "Indicator Value Computation" in Part A of the same document) — by
 * recombining the `components` of every contributing source instance
 * once dedup/merge has decided they represent the same real-world
 * concept. See `recombineComputedValues` below for exactly how that
 * recombination avoids double-counting for ratio/sum/mean/count, and
 * where it can only degrade to an honestly-labeled sum (count_distinct
 * across more than one source, since cross-file participant identity is
 * deliberately unresolved — see "Stable Cross-File Identity").
 */
export class ProjectKnowledgeBuilderService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeIndicatorRepository: KnowledgeIndicatorRepository,
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

    await this.persistKnowledgeIndicators(
      projectKnowledgeModel.id,
      entitiesByType.get("indicator") ?? [],
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
      const computedValue = indicator.computedValue;
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
          // Only carried through when grounding actually passed — a
          // failed computation is not something later recombination
          // should ever try to use, per "Indicator Value Computation".
          computedValue:
            computedValue && computedValue.groundingStatus === "passed"
              ? {
                  sourceKind: computedValue.sourceKind,
                  operation: indicator.suggestedCalculation?.operation ?? null,
                  value: computedValue.value,
                  unit: computedValue.unit,
                  components: computedValue.components,
                  groundingStatus: computedValue.groundingStatus,
                  confidence: indicator.confidence,
                }
              : null,
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
          qualitativeContext: {
            category: finding.category,
            outcomeReference: finding.outcomeReference,
            outcomeAnchorType: finding.outcomeAnchorType,
            relationToEvidence: finding.relationToEvidence,
          },
        },
      });
    }

    return candidates;
  }

  /**
   * Removes source instances that no longer represent verified, kept
   * data: either the interpretation result they came from is no longer
   * the latest/acknowledged one for its activity (superseded, the
   * activity was un-acknowledged/deleted, or its evidence was deleted),
   * or that specific item is still on the latest result but is no longer
   * kept (e.g. an indicator that was rejected after already contributing
   * to a prior build). This is what makes a rejection, a deletion, or an
   * interpretation re-run actually take effect on the next build, rather
   * than a stale merge lingering forever. Mutates `existingEntities` in
   * place so the caller's subsequent matching sees the pruned state.
   *
   * An entity that ends up with zero source instances is deleted
   * outright, never left behind as an empty orphan. This matters beyond
   * tidiness: hasCompatibleActivity treats an entity with no known
   * source instances as an unconstrained wildcard match, so an orphaned
   * entity left in place would silently become eligible to false-merge
   * with the next candidate of the same type, regardless of activity.
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

    const emptiedEntityIds: string[] = [];
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
        if (updated.sourceInstances.length === 0) {
          emptiedEntityIds.push(updated.id);
        }
      }
    }

    if (emptiedEntityIds.length > 0) {
      await this.knowledgeEntityRepository.deleteMany(
        emptiedEntityIds,
        databaseSession,
      );
      const remainingEntities = existingEntities.filter(
        (entity) => !emptiedEntityIds.includes(entity.id),
      );
      existingEntities.splice(0, existingEntities.length, ...remainingEntities);
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
          this.hasCompatibleActivity(entity, candidate.sourceInstance),
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

        if (!alreadyRecorded) {
          const mergedEntity = {
            ...match,
            sourceInstances: [
              ...match.sourceInstances,
              candidate.sourceInstance,
            ],
          };
          this.replaceInBucket(existingOfType, mergedEntity);

          const pending = pendingSourceInstanceMerges.get(match.id) ?? [];
          pending.push(candidate.sourceInstance);
          pendingSourceInstanceMerges.set(match.id, pending);
        }
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

  /**
   * Tier 2 matches never merge across two different activities, even
   * with an exact name + description match. Similarly-worded indicators
   * from two distinct activities are not necessarily the same
   * underlying metric — the NGO drew that activity boundary
   * deliberately, and lexical similarity alone can't tell us whether
   * two activities' goals happen to overlap or just happen to use
   * similar words. A false merge across activities is worse than a
   * missed one; that judgment call (are these actually the same
   * concept?) is deferred to an explicit, human-confirmed cross-activity
   * linking step, not made automatically here based on text similarity.
   *
   * (`activityType` compatibility was tried first and found
   * insufficient: two distinct activities sharing a broad type like
   * "mentoring" still have their own distinct goals, and a shared
   * `activityType` said nothing about whether they should merge.)
   */
  private hasCompatibleActivity(
    entity: KnowledgeEntityPersistenceRecord,
    candidateInstance: KnowledgeSourceInstance,
  ): boolean {
    const knownActivityIds = new Set(
      entity.sourceInstances.map((instance) => instance.activityId),
    );

    if (knownActivityIds.size === 0) {
      return true;
    }

    return knownActivityIds.has(candidateInstance.activityId);
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

  /**
   * Persist: recompute every indicator entity's KnowledgeIndicator value
   * from its current (post-merge, post-prune) sourceInstances and write
   * it fresh. Values are cheap to recompute — unlike identity, which must
   * be preserved via merge — so this deletes and rewrites this project's
   * indicator values each build rather than tracking incremental deltas,
   * matching the original "Persist — write everything for this build in
   * one pass" design.
   */
  private async persistKnowledgeIndicators(
    projectKnowledgeModelId: string,
    indicatorEntities: KnowledgeEntityPersistenceRecord[],
  ): Promise<void> {
    await this.knowledgeIndicatorRepository.deleteByProjectKnowledgeModelId(
      projectKnowledgeModelId,
      databaseSession,
    );

    const creates: KnowledgeIndicatorCreateInput[] = [];
    for (const entity of indicatorEntities) {
      const recombined = recombineComputedValues(entity.sourceInstances);
      const primarySourceInstance = entity.sourceInstances[0];
      if (!recombined || recombined.value === null || !primarySourceInstance) {
        continue;
      }

      creates.push({
        projectKnowledgeModelId,
        knowledgeEntityId: entity.id,
        value: recombined.value,
        unit: recombined.unit,
        activityId: primarySourceInstance.activityId,
        participantId: null,
        sourceEvidence: {
          uploadMetadataId: primarySourceInstance.uploadMetadataId,
          interpretationResultId: primarySourceInstance.interpretationResultId,
          sourceReference: primarySourceInstance.sourceReference,
        },
        confidence: recombined.confidence,
        deduplicationConfidence: recombined.deduplicationConfidence,
      });
    }

    if (creates.length > 0) {
      await this.knowledgeIndicatorRepository.createMany(
        creates,
        databaseSession,
      );
    }
  }
}

interface RecombinedIndicatorValue {
  value: number | null;
  unit: string | null;
  confidence: number;
  deduplicationConfidence: KnowledgeIndicatorDeduplicationConfidence;
}

function readComponentNumber(
  components: Record<string, unknown>,
  key: string,
): number {
  const value = components[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function averageConfidence(instances: Array<{ confidence: number }>): number {
  if (instances.length === 0) {
    return 0;
  }
  return (
    instances.reduce((total, instance) => total + instance.confidence, 0) /
    instances.length
  );
}

/**
 * Recombines every source instance's computedValue.components into one
 * KnowledgeIndicator value — never by summing or averaging already-final
 * `value`s, which would be mathematically wrong for ratio/mean (see
 * "Merging computed values" in "Phase 4 — Project Knowledge Model.md").
 * All contributing instances are expected to share the same operation —
 * Tier 2 dedup already confirmed they're the same real-world concept — so
 * a mismatch fails closed (returns null) rather than guessing which one
 * to trust. Returns null when nothing here is actually computable
 * (distribution/trend produce no single scalar `value` in this version,
 * or no source instance has a passed computedValue at all).
 */
function recombineComputedValues(
  sourceInstances: KnowledgeSourceInstance[],
): RecombinedIndicatorValue | null {
  const computed = sourceInstances
    .map((instance) => instance.computedValue)
    .filter(
      (value): value is NonNullable<KnowledgeSourceInstance["computedValue"]> =>
        Boolean(value) && value!.groundingStatus === "passed",
    );

  if (computed.length === 0) {
    return null;
  }

  const confidence = averageConfidence(computed);
  // The real unit each Python computation already assigned (e.g. "%",
  // "as_stated") — never fabricated from the operation name, which is
  // sometimes coincidentally the same string (e.g. "count") but isn't the
  // same thing and shouldn't be relied on to match.
  const unit = computed[0]!.unit;

  // A narrative-extracted value (an explicitly stated number pulled
  // directly from text, sourceKind "extracted_from_text") carries no
  // `operation` — it's a stated fact, not a count/sum/ratio to recombine,
  // so it must be handled before the operation-based switch below, which
  // would otherwise treat its null operation as "nothing to recombine"
  // and silently drop it (that was the bug: a narrative indicator with a
  // real, grounded value never produced a KnowledgeIndicator at all).
  // Combining more than one independently-stated number for the same
  // indicator concept has no safe arithmetic the way tabular operations
  // do, so more than one such instance is left unresolved rather than
  // guessed at.
  if (
    computed.every((instance) => instance.sourceKind === "extracted_from_text")
  ) {
    if (computed.length > 1) {
      return null;
    }
    return {
      value: computed[0]!.value,
      unit: unit ?? "as_stated",
      confidence,
      deduplicationConfidence: "not_applicable",
    };
  }

  const operation: IndicatorCalculationOperation | null =
    computed[0]!.operation;
  if (
    !operation ||
    computed.some((instance) => instance.operation !== operation)
  ) {
    return null;
  }

  switch (operation) {
    case "ratio": {
      let numeratorCount = 0;
      let denominatorCount = 0;
      for (const instance of computed) {
        numeratorCount += readComponentNumber(
          instance.components,
          "numeratorCount",
        );
        denominatorCount += readComponentNumber(
          instance.components,
          "denominatorCount",
        );
      }
      return {
        value: denominatorCount > 0 ? numeratorCount / denominatorCount : null,
        unit: unit ?? "ratio",
        confidence,
        deduplicationConfidence: "not_applicable",
      };
    }
    case "mean": {
      let sum = 0;
      let count = 0;
      for (const instance of computed) {
        sum += readComponentNumber(instance.components, "sum");
        count += readComponentNumber(instance.components, "count");
      }
      return {
        value: count > 0 ? sum / count : null,
        unit: unit ?? "mean",
        confidence,
        deduplicationConfidence: "not_applicable",
      };
    }
    case "sum": {
      let sum = 0;
      for (const instance of computed) {
        sum += readComponentNumber(instance.components, "sum");
      }
      return {
        value: sum,
        unit: unit ?? "sum",
        confidence,
        deduplicationConfidence: "not_applicable",
      };
    }
    case "count": {
      let count = 0;
      for (const instance of computed) {
        count += readComponentNumber(instance.components, "count");
      }
      return {
        value: count,
        unit: unit ?? "count",
        confidence,
        deduplicationConfidence: "not_applicable",
      };
    }
    case "count_distinct": {
      let count = 0;
      for (const instance of computed) {
        count += readComponentNumber(instance.components, "count");
      }
      return {
        value: count,
        unit: unit ?? "count",
        confidence,
        deduplicationConfidence:
          computed.length > 1
            ? "not_deduplicated_across_sources"
            : "not_applicable",
      };
    }
    default:
      // distribution/trend: no single scalar value to recombine into
      // KnowledgeIndicator.value in this version.
      return null;
  }
}
