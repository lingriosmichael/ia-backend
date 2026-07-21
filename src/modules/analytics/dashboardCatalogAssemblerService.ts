import { databaseSession } from "../../shared/database/databaseClient.js";
import type { KnowledgeSourceInstance } from "../../shared/contracts.js";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import type { ProjectKnowledgeModelStatus } from "../../shared/contracts.js";
import type { KnowledgeEntityRepository } from "../knowledge/knowledgeEntityRepository.js";
import type { KnowledgeIndicatorRepository } from "../knowledge/knowledgeIndicatorRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DeterministicAnalysisRepository } from "../interpretation/deterministicAnalysisRepository.js";
import type {
  AnalyticsScope,
  EvidenceCatalog,
  EvidenceCatalogQualitySignal,
  EvidenceCatalogMetricEntry,
  EvidenceCatalogOmittedEntry,
  EvidenceCatalogThemeEntry,
  EvidenceCatalogThemeSourceInstance,
} from "./analyticsContracts.js";
import { deriveEvidenceStrength } from "./evidenceStrength.js";

const CATALOG_VERSION = "3.0";

export interface AssembledCatalog {
  catalog: EvidenceCatalog;
  projectKnowledgeModelStatus: ProjectKnowledgeModelStatus | null;
  scopedInterpretationResultIds: string[];
}

function emptyCatalog(scope: AnalyticsScope): EvidenceCatalog {
  return {
    catalogVersion: CATALOG_VERSION,
    knowledgeModelVersion: 0,
    scope,
    entries: [],
    omittedEntries: [],
    qualitySignals: [],
  };
}

function filterSourceInstancesForScope(
  sourceInstances: KnowledgeSourceInstance[],
  scope: AnalyticsScope,
): KnowledgeSourceInstance[] {
  if (scope.type !== "ACTIVITY") {
    return sourceInstances;
  }
  return sourceInstances.filter(
    (instance) => instance.activityId === scope.activityId,
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
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
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
    private readonly deterministicAnalysisRepository: DeterministicAnalysisRepository,
  ) {}

  async assemble(scope: AnalyticsScope): Promise<AssembledCatalog> {
    const model = await this.projectKnowledgeModelRepository.findByProjectId(
      scope.projectId,
      databaseSession,
    );
    if (!model) {
      return {
        catalog: emptyCatalog(scope),
        projectKnowledgeModelStatus: null,
        scopedInterpretationResultIds: [],
      };
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
    const scopedInterpretationResultIds = new Set<string>();

    for (const indicator of indicators) {
      if (
        scope.type === "ACTIVITY" &&
        indicator.activityId !== scope.activityId
      ) {
        continue;
      }
      const entity = entityById.get(indicator.knowledgeEntityId);
      if (!entity) {
        // Should not happen in practice (a KnowledgeIndicator always has a
        // parent entity) — fail closed rather than surface a labelless entry.
        continue;
      }
      const relevantSourceInstances = filterSourceInstancesForScope(
        entity.sourceInstances,
        scope,
      );
      for (const sourceInstance of relevantSourceInstances) {
        scopedInterpretationResultIds.add(
          sourceInstance.interpretationResultId,
        );
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
          interpretationResultId:
            indicator.sourceEvidence.interpretationResultId,
          sourceReference: indicator.sourceEvidence.sourceReference,
        },
        evidenceStrength: deriveEvidenceStrength(indicator.confidence),
      });
    }

    const themeEntries: EvidenceCatalogThemeEntry[] = [];
    const omittedEntries: EvidenceCatalogOmittedEntry[] = [];

    for (const entity of entities) {
      if (entity.entityType === "theme") {
        const relevantInstances = filterSourceInstancesForScope(
          entity.sourceInstances,
          scope,
        );
        if (relevantInstances.length === 0) {
          continue;
        }
        for (const sourceInstance of relevantInstances) {
          scopedInterpretationResultIds.add(
            sourceInstance.interpretationResultId,
          );
        }
        themeEntries.push({
          entryId: entity.id,
          entryType: "QUALITATIVE_THEME",
          label: entity.canonicalLabel,
          description: entity.description,
          quoteCount: relevantInstances.length,
          categories: uniqueStrings(
            relevantInstances.map(
              (instance) => instance.qualitativeContext?.category ?? null,
            ),
          ) as EvidenceCatalogThemeEntry["categories"],
          outcomeReferences: uniqueStrings(
            relevantInstances.map(
              (instance) =>
                instance.qualitativeContext?.outcomeReference ?? null,
            ),
          ),
          outcomeAnchorTypes: uniqueStrings(
            relevantInstances.map(
              (instance) =>
                instance.qualitativeContext?.outcomeAnchorType ?? null,
            ),
          ) as EvidenceCatalogThemeEntry["outcomeAnchorTypes"],
          sourceActivityIds: [
            ...new Set(
              relevantInstances.map((instance) => instance.activityId),
            ),
          ],
          sourceUploadMetadataIds: [
            ...new Set(
              relevantInstances.map((instance) => instance.uploadMetadataId),
            ),
          ],
          sourceInstances: relevantInstances.map(
            (instance): EvidenceCatalogThemeSourceInstance => ({
              uploadMetadataId: instance.uploadMetadataId,
              interpretationResultId: instance.interpretationResultId,
              sourceReference: instance.sourceReference,
            }),
          ),
        });
        continue;
      }

      if (entity.entityType === "indicator") {
        const relevantSourceInstances = filterSourceInstancesForScope(
          entity.sourceInstances,
          scope,
        );
        const inScope = relevantSourceInstances.length > 0;
        for (const sourceInstance of relevantSourceInstances) {
          scopedInterpretationResultIds.add(
            sourceInstance.interpretationResultId,
          );
        }
        if (inScope && !indicatorEntityIdsWithValue.has(entity.id)) {
          omittedEntries.push({
            knowledgeEntityId: entity.id,
            reason:
              "No computed value is available yet for this indicator concept.",
          });
        }
      }
    }

    const qualitySignals = await this.buildQualitySignals([
      ...scopedInterpretationResultIds,
    ]);

    return {
      catalog: {
        catalogVersion: CATALOG_VERSION,
        knowledgeModelVersion: model.version,
        scope,
        entries: [...metricEntries, ...themeEntries],
        omittedEntries,
        qualitySignals,
      },
      projectKnowledgeModelStatus: model.status,
      scopedInterpretationResultIds: [...scopedInterpretationResultIds],
    };
  }

  private async buildQualitySignals(
    interpretationResultIds: string[],
  ): Promise<EvidenceCatalogQualitySignal[]> {
    if (interpretationResultIds.length === 0) {
      return [];
    }

    const [datasetPreparations, deterministicAnalyses] = await Promise.all([
      this.datasetPreparationRepository.findByInterpretationResultIds(
        interpretationResultIds,
        databaseSession,
      ),
      this.deterministicAnalysisRepository.findByInterpretationResultIds(
        interpretationResultIds,
        databaseSession,
      ),
    ]);

    const signals = new Map<string, EvidenceCatalogQualitySignal>();
    const registerSignal = (signal: EvidenceCatalogQualitySignal) => {
      const key = [
        signal.sourceType,
        signal.interpretationResultId,
        signal.severity,
        signal.message,
      ].join("::");
      if (!signals.has(key)) {
        signals.set(key, signal);
      }
    };

    for (const preparation of datasetPreparations) {
      if (
        preparation.status !== "ready_for_analysis" &&
        preparation.status !== "analysis_completed"
      ) {
        registerSignal({
          signalId: `prep-status:${preparation.id}`,
          sourceType: "dataset_preparation",
          interpretationResultId: preparation.interpretationResultId,
          activityId: preparation.activityId,
          uploadMetadataId: preparation.uploadMetadataId,
          severity: "warning",
          message: `Dataset preparation is ${preparation.status.replaceAll("_", " ")}.`,
        });
      }

      if (preparation.unansweredBlockingQuestionIds.length > 0) {
        registerSignal({
          signalId: `prep-blocking:${preparation.id}`,
          sourceType: "dataset_preparation",
          interpretationResultId: preparation.interpretationResultId,
          activityId: preparation.activityId,
          uploadMetadataId: preparation.uploadMetadataId,
          severity: "warning",
          message:
            "Some dataset preparation questions remain unanswered, so quantitative analysis may be incomplete.",
        });
      }

      const preparedDataset = preparation.preparedDataset;
      if (!preparedDataset) {
        continue;
      }

      for (const [
        index,
        requirement,
      ] of preparedDataset.unresolvedRequirements.entries()) {
        registerSignal({
          signalId: `prep-unresolved:${preparation.id}:${index}`,
          sourceType: "dataset_preparation",
          interpretationResultId: preparation.interpretationResultId,
          activityId: preparation.activityId,
          uploadMetadataId: preparation.uploadMetadataId,
          severity: "warning",
          message: requirement,
        });
      }

      for (const table of preparedDataset.tables) {
        for (const [index, note] of table.notes.entries()) {
          registerSignal({
            signalId: `prep-note:${preparation.id}:${table.name}:${index}`,
            sourceType: "dataset_preparation",
            interpretationResultId: preparation.interpretationResultId,
            activityId: preparation.activityId,
            uploadMetadataId: preparation.uploadMetadataId,
            severity: "info",
            message: `${table.name}: ${note}`,
          });
        }
      }
    }

    for (const analysis of deterministicAnalyses) {
      if (analysis.status !== "ready") {
        registerSignal({
          signalId: `analysis-status:${analysis.id}`,
          sourceType: "deterministic_analysis",
          interpretationResultId: analysis.interpretationResultId,
          activityId: analysis.activityId,
          uploadMetadataId: analysis.uploadMetadataId,
          severity: "warning",
          message: `Deterministic analysis is ${analysis.status.replaceAll("_", " ")}.`,
        });
      }

      for (const [index, warning] of analysis.warnings.entries()) {
        registerSignal({
          signalId: `analysis-warning:${analysis.id}:${index}`,
          sourceType: "deterministic_analysis",
          interpretationResultId: analysis.interpretationResultId,
          activityId: analysis.activityId,
          uploadMetadataId: analysis.uploadMetadataId,
          severity: "warning",
          message: warning.message,
        });
      }
    }

    return [...signals.values()];
  }
}
