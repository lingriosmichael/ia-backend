import { databaseSession } from "../../shared/database/databaseClient.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { ProjectKnowledgeModelStatus } from "../../shared/contracts.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeIndicatorRepository } from "../knowledge/knowledgeIndicatorRepository.js";
import type {
  AnalyticsScope,
  EvidenceCatalog,
  EvidenceCatalogMetricEntry,
  EvidenceCatalogOmittedEntry,
  EvidenceCatalogThemeEntry,
} from "./analyticsContracts.js";

const CATALOG_VERSION = "3.0";

export interface AssembledCatalog {
  catalog: EvidenceCatalog;
  projectKnowledgeModelStatus: ProjectKnowledgeModelStatus | null;
}

function emptyCatalog(scope: AnalyticsScope): EvidenceCatalog {
  return {
    catalogVersion: CATALOG_VERSION,
    knowledgeModelVersion: 0,
    scope,
    entries: [],
    omittedEntries: [],
  };
}

/**
 * Section 1 of "Phase 5 — Deterministic Analytics.md": retrieves and
 * reshapes already-computed KnowledgeIndicator/KnowledgeEntity(theme)
 * records into a versioned Evidence Catalog. Performs zero computation —
 * every value here was already computed and merge-recombined by Phase 4
 * (ProjectKnowledgeBuilderService). No LLM call anywhere in this class.
 */
export class DashboardCatalogAssemblerService {
  constructor(
    private readonly projectKnowledgeModelRepository: ProjectKnowledgeModelRepository,
    private readonly knowledgeEntityRepository: KnowledgeEntityRepository,
    private readonly knowledgeIndicatorRepository: KnowledgeIndicatorRepository,
  ) {}

  async assemble(scope: AnalyticsScope): Promise<AssembledCatalog> {
    const model = await this.projectKnowledgeModelRepository.findByProjectId(
      scope.projectId,
      databaseSession,
    );
    if (!model) {
      return { catalog: emptyCatalog(scope), projectKnowledgeModelStatus: null };
    }

    const [entities, indicators] = await Promise.all([
      this.knowledgeEntityRepository.listByProjectKnowledgeModelId(
        model.id,
        databaseSession,
      ),
      this.knowledgeIndicatorRepository.listByProjectKnowledgeModelId(
        model.id,
        databaseSession,
      ),
    ]);

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const indicatorEntityIdsWithValue = new Set(
      indicators.map((indicator) => indicator.knowledgeEntityId),
    );

    const metricEntries: EvidenceCatalogMetricEntry[] = [];
    for (const indicator of indicators) {
      if (scope.type === "ACTIVITY" && indicator.activityId !== scope.activityId) {
        continue;
      }
      const entity = entityById.get(indicator.knowledgeEntityId);
      if (!entity) {
        // Should not happen in practice (a KnowledgeIndicator always has a
        // parent entity) — fail closed rather than surface a labelless entry.
        continue;
      }
      metricEntries.push({
        entryId: indicator.id,
        entryType: "METRIC",
        label: entity.canonicalLabel,
        description: entity.description,
        value: indicator.value,
        unit: indicator.unit,
        deduplicationConfidence: indicator.deduplicationConfidence,
        activityId: indicator.activityId,
        provenance: {
          knowledgeEntityId: entity.id,
          uploadMetadataId: indicator.sourceEvidence.uploadMetadataId,
          interpretationResultId: indicator.sourceEvidence.interpretationResultId,
          sourceReference: indicator.sourceEvidence.sourceReference,
        },
      });
    }

    const themeEntries: EvidenceCatalogThemeEntry[] = [];
    const omittedEntries: EvidenceCatalogOmittedEntry[] = [];

    for (const entity of entities) {
      if (entity.entityType === "theme") {
        const relevantInstances =
          scope.type === "ACTIVITY"
            ? entity.sourceInstances.filter(
                (instance) => instance.activityId === scope.activityId,
              )
            : entity.sourceInstances;
        if (relevantInstances.length === 0) {
          continue;
        }
        themeEntries.push({
          entryId: entity.id,
          entryType: "QUALITATIVE_THEME",
          label: entity.canonicalLabel,
          description: entity.description,
          quoteCount: relevantInstances.length,
          sourceActivityIds: [
            ...new Set(relevantInstances.map((instance) => instance.activityId)),
          ],
          sourceUploadMetadataIds: [
            ...new Set(
              relevantInstances.map((instance) => instance.uploadMetadataId),
            ),
          ],
        });
        continue;
      }

      if (entity.entityType === "indicator") {
        const inScope =
          scope.type === "ACTIVITY"
            ? entity.sourceInstances.some(
                (instance) => instance.activityId === scope.activityId,
              )
            : entity.sourceInstances.length > 0;
        if (inScope && !indicatorEntityIdsWithValue.has(entity.id)) {
          omittedEntries.push({
            knowledgeEntityId: entity.id,
            reason:
              "No computed value is available yet for this indicator concept.",
          });
        }
      }
    }

    return {
      catalog: {
        catalogVersion: CATALOG_VERSION,
        knowledgeModelVersion: model.version,
        scope,
        entries: [...metricEntries, ...themeEntries],
        omittedEntries,
      },
      projectKnowledgeModelStatus: model.status,
    };
  }
}
