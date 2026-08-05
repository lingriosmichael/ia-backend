import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  mapActivity,
  mapInterpretationResult,
  mapProcessingJob,
} from "../../shared/utils/mappers.js";
import type {
  ActivitySummary,
  ActivityAiKnowledgeInsight,
  ActivityAiKnowledgeRecord,
  ActivityWorkflowStageRecord,
  InterpretationIndicatorStatus,
  ProjectInterpretationOverview,
  StartActivityInterpretationResponse,
  StartInterpretationResponse,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { ProcessingJobRepository } from "../ai/execution/processingJobRepository.js";
import type { ProcessingJobPersistenceRecord } from "../ai/persistence/aiPersistenceTypes.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { ProjectKnowledgeBuilderService } from "../knowledge/projectKnowledgeBuilderService.js";
import type { ProjectLlmTokenLedgerService } from "../project/projectLlmTokenLedgerService.js";
import type { EvidenceLinkageReconciliationService } from "../linkage/evidenceLinkageReconciliationService.js";
import type { ActivityEvidenceLinkageResultRepository } from "../linkage/activityEvidenceLinkageResultRepository.js";
import {
  computeActivityWorkflowStage,
  type ActivityWorkflowStage,
} from "../activity/activityWorkflowStage.js";
import type { ActivityEvidenceLinkageResultPersistenceRecord } from "../linkage/activityEvidenceLinkageResultPersistence.js";
import {
  buildCrossFileCrosstabs,
  computeCohortFlagPrevalences,
  computeGoalGap,
  type LinkageGoalVerdict,
} from "../linkage/linkageIndicatorCalculations.js";
import type {
  AiKnowledgeContradictionInput,
  AiKnowledgeCoverageIssueInput,
  AiKnowledgeIndicatorInput,
} from "../processing/pythonProcessingClient.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import {
  clearActivityAiKnowledgeStateIfPresent,
  hasPendingBlockingQuestions,
  isBlockingQuestion,
} from "./interpretationReviewState.js";
import { DatasetPreparationService } from "./datasetPreparationService.js";
import {
  classifyEvidenceModalityFromPayload,
  getEvidenceModalitySupportState,
  isEvidenceModalitySupported,
} from "../../shared/utils/evidenceModality.js";
import { DeterministicAnalysisService } from "./deterministicAnalysisService.js";
import { QuantitativeInterpretationSynthesisService } from "./quantitativeInterpretationSynthesisService.js";
import type { DeterministicAnalysisPersistenceRecord } from "./deterministicAnalysisPersistence.js";
import type { InterpretationResultPersistenceRecord } from "./interpretationResultPersistence.js";
import type { ActivityAiKnowledgeSnapshotPersistenceRecord } from "../activity/activityPersistence.js";

interface ActivityAiKnowledgeDraft {
  id: string;
  sourceType: ActivityAiKnowledgeInsight["sourceType"];
  text: string;
  isGoalRelevant: boolean;
  sourceUploadMetadataIds: string[];
  confidence: number;
}

const MAX_CONTEXT_ONLY_FINDINGS = 2;

function normalizeInsightText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function ensureTerminalPunctuation(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function deduplicateInsights(
  drafts: ActivityAiKnowledgeDraft[],
): ActivityAiKnowledgeDraft[] {
  const seen = new Set<string>();
  const deduplicated: ActivityAiKnowledgeDraft[] = [];
  for (const draft of drafts) {
    const normalizedText = normalizeInsightText(draft.text).toLowerCase();
    if (!normalizedText || seen.has(normalizedText)) {
      continue;
    }
    seen.add(normalizedText);
    deduplicated.push({
      ...draft,
      text: ensureTerminalPunctuation(normalizeInsightText(draft.text)),
    });
  }
  return deduplicated;
}

function isGoalRelevantFinding(
  finding: InterpretationResultPersistenceRecord["qualitativeFindings"][number],
): boolean {
  return (
    finding.outcomeAnchorType !== "unanchored" ||
    finding.relationToEvidence !== "context_only" ||
    finding.category !== "context_only"
  );
}

function isIncludedInAiKnowledge(
  status: InterpretationIndicatorStatus,
): boolean {
  // The old review UI could explicitly reject indicators/findings. The
  // simplified flow now auto-keeps newly generated items, but the
  // persistence flag still exists for backward compatibility and for any
  // legacy records that were previously rejected.
  return status !== "rejected";
}

function formatCountOrPercent(
  count: number,
  ratio: number | null,
  language: "de" | "en",
): string {
  if (ratio !== null && Number.isFinite(ratio)) {
    const percentage = Math.round(ratio * 100);
    return language === "de"
      ? `${percentage} % (${count})`
      : `${percentage}% (${count})`;
  }

  return `${count}`;
}

function formatNullableCategoryValue(
  value: string | null,
  language: "de" | "en",
): string {
  if (value !== null && value.trim().length > 0) {
    return value.trim();
  }

  return language === "de" ? "unbekannt" : "unknown";
}

function getProcessingJobCreatedTimestamp(
  job: Pick<ProcessingJobPersistenceRecord, "createdAt">,
) {
  const createdAt = job.createdAt instanceof Date ? job.createdAt : null;
  return createdAt ? createdAt.getTime() : 0;
}

function getLatestJobByUploadMetadataId(
  jobs: ProcessingJobPersistenceRecord[],
) {
  const latestJobByUploadId = new Map<string, ProcessingJobPersistenceRecord>();

  for (const job of jobs
    .filter(
      (
        job,
      ): job is ProcessingJobPersistenceRecord & { uploadMetadataId: string } =>
        typeof job.uploadMetadataId === "string",
    )
    .sort((left, right) => {
      return (
        getProcessingJobCreatedTimestamp(right) -
        getProcessingJobCreatedTimestamp(left)
      );
    })) {
    if (!latestJobByUploadId.has(job.uploadMetadataId)) {
      latestJobByUploadId.set(job.uploadMetadataId, job);
    }
  }

  return latestJobByUploadId;
}

function buildDistributionSignalDrafts(
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  const drafts: ActivityAiKnowledgeDraft[] = [];

  for (const [
    interpretationResultId,
    analysis,
  ] of analysesByInterpretationResultId) {
    for (const distribution of analysis.distributions) {
      const meaningfulBuckets = distribution.buckets
        .filter((bucket) => bucket.count > 0)
        .sort((left, right) => right.count - left.count);
      if (meaningfulBuckets.length < 2) {
        continue;
      }

      const topBuckets = meaningfulBuckets.slice(0, 2);
      const bucketSummary = topBuckets
        .map(
          (bucket) =>
            `${formatNullableCategoryValue(bucket.value, language)} ${formatCountOrPercent(
              bucket.count,
              bucket.ratio,
              language,
            )}`,
        )
        .join(language === "de" ? ", gefolgt von " : ", followed by ");

      drafts.push({
        id: `${interpretationResultId}:${distribution.distributionKey}`,
        sourceType: "distribution_signal",
        text:
          language === "de"
            ? `${distribution.label}: die größten Anteile entfallen auf ${bucketSummary}`
            : `${distribution.label}: the largest shares are ${bucketSummary}`,
        isGoalRelevant: false,
        sourceUploadMetadataIds: [analysis.uploadMetadataId],
        confidence: 1,
      });
    }

    for (const breakdown of analysis.subgroupBreakdowns) {
      const meaningfulSegments = breakdown.segments
        .filter((segment) => segment.rowCount > 0)
        .sort((left, right) => right.rowCount - left.rowCount);
      if (meaningfulSegments.length < 2) {
        continue;
      }

      const topSegments = meaningfulSegments.slice(0, 2);
      const segmentSummary = topSegments
        .map(
          (segment) =>
            `${formatNullableCategoryValue(
              segment.value,
              language,
            )} ${formatCountOrPercent(
              segment.rowCount,
              segment.positiveRatio,
              language,
            )}`,
        )
        .join(language === "de" ? ", gefolgt von " : ", followed by ");

      drafts.push({
        id: `${interpretationResultId}:${breakdown.breakdownKey}`,
        sourceType: "distribution_signal",
        text:
          language === "de"
            ? `${breakdown.label}: die auffälligsten Segmente sind ${segmentSummary}`
            : `${breakdown.label}: the most notable segments are ${segmentSummary}`,
        isGoalRelevant: false,
        sourceUploadMetadataIds: [analysis.uploadMetadataId],
        confidence: 1,
      });
    }
  }

  return deduplicateInsights(drafts);
}

// §7 bullet 3: crosstabs between fields living in *different* source
// files, computed against the joined entity table (§6). This is the one
// crosstab shape deterministicAnalysisService.ts's per-table §2.9 logic
// cannot produce on its own.
function buildLinkageCrossFileCrosstabDrafts(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  if (!linkageResult) {
    return [];
  }

  const drafts: ActivityAiKnowledgeDraft[] = [];
  for (const group of linkageResult.groups) {
    for (const crosstab of buildCrossFileCrosstabs(group.entities)) {
      const topCells = [...crosstab.cells]
        .sort((left, right) => right.count - left.count)
        .slice(0, 2);
      if (topCells.length === 0) {
        continue;
      }

      const cellSummary = topCells
        .map(
          (cell) =>
            `${cell.valueA} / ${cell.valueB} ${formatCountOrPercent(
              cell.count,
              cell.ratio,
              language,
            )}`,
        )
        .join(language === "de" ? ", gefolgt von " : ", followed by ");

      drafts.push({
        id: `linkage-crosstab:${linkageResult.activityId}:${crosstab.fieldNameA}:${crosstab.fieldNameB}`,
        sourceType: "distribution_signal",
        text:
          language === "de"
            ? `${crosstab.fieldNameA} (${crosstab.sourceTableNameA}) x ${crosstab.fieldNameB} (${crosstab.sourceTableNameB}), über Dateien hinweg verknüpft: ${cellSummary}`
            : `${crosstab.fieldNameA} (${crosstab.sourceTableNameA}) x ${crosstab.fieldNameB} (${crosstab.sourceTableNameB}), linked across files: ${cellSummary}`,
        isGoalRelevant: false,
        sourceUploadMetadataIds: group.linkedUploadMetadataIds,
        confidence: 1,
      });
    }
  }

  return deduplicateInsights(drafts);
}

// §8's "same-entity-different-value" rule, mechanical half (Tier B
// conflicts from §4 reconciliation) — the byte-level, same-field-name
// disagreements are surfaced here directly. Genuine cross-field semantic
// contradictions (§3.1 of the AI-knowledge audit's examples) would need a
// per-dataset-type rule config that doesn't exist yet; see design doc §15.2(B).
function buildLinkageContradictionDrafts(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  if (!linkageResult) {
    return [];
  }

  const drafts: ActivityAiKnowledgeDraft[] = [];
  for (const group of linkageResult.groups) {
    for (const conflict of group.conflicts) {
      const competingValueSummary = conflict.competingValues
        .map(
          (competing) => `"${competing.value}" (${competing.sourceTableName})`,
        )
        .join(" vs. ");

      drafts.push({
        id: `linkage-conflict:${linkageResult.activityId}:${conflict.entityKey}:${conflict.fieldName}`,
        sourceType: "linkage_contradiction",
        text:
          language === "de"
            ? `Eintrag ${conflict.entityKey}, Feld "${conflict.fieldName}": widersprüchliche Werte über Dateien hinweg: ${competingValueSummary}`
            : `Entry ${conflict.entityKey}, field "${conflict.fieldName}": conflicting values across files: ${competingValueSummary}`,
        isGoalRelevant: true,
        sourceUploadMetadataIds: group.linkedUploadMetadataIds,
        confidence: 1,
      });
    }
  }

  return deduplicateInsights(drafts);
}

// §8's coverage-gap rule: a positive decision co-occurring with an
// unresolved flag/remark recorded in a *different* source file. This is
// the highest-value fact class this whole design exists to surface (the
// walkthrough's "12 of 20 selected candidates carry an unresolved
// safeguarding flag").
function buildLinkageCoverageIssueDrafts(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  if (!linkageResult) {
    return [];
  }

  const drafts: ActivityAiKnowledgeDraft[] = [];
  for (const group of linkageResult.groups) {
    const prevalences = computeCohortFlagPrevalences(
      group.entities,
      group.positiveStatusFieldDefinitions,
    );

    for (const prevalence of prevalences) {
      if (prevalence.flaggedCount === 0) {
        continue;
      }

      drafts.push({
        id: `linkage-coverage:${linkageResult.activityId}:${prevalence.cohortFieldName}:${prevalence.flagFieldName}`,
        sourceType: "linkage_coverage_issue",
        text:
          language === "de"
            ? `${prevalence.flaggedCount} von ${prevalence.cohortSize} Einträgen mit "${prevalence.cohortFieldName}: ${prevalence.cohortValueLabel}" haben einen ungeklärten Eintrag bei "${prevalence.flagFieldName}" (${formatCountOrPercent(prevalence.flaggedCount, prevalence.ratio, language)})`
            : `${prevalence.flaggedCount} of ${prevalence.cohortSize} entries marked "${prevalence.cohortFieldName}: ${prevalence.cohortValueLabel}" carry an unresolved "${prevalence.flagFieldName}" entry (${formatCountOrPercent(prevalence.flaggedCount, prevalence.ratio, language)})`,
        isGoalRelevant: true,
        sourceUploadMetadataIds: group.linkedUploadMetadataIds,
        confidence: 1,
      });
    }
  }

  return deduplicateInsights(drafts);
}

const AI_KNOWLEDGE_GOAL_VERDICT_TO_MET_GOAL: Record<
  LinkageGoalVerdict,
  "true" | "false" | "partial"
> = {
  achieved: "true",
  partly_achieved: "partial",
  not_achieved: "false",
};

function goalTextForIndicatorRelevanceStage(
  activity: { output: string | null; outcome: string | null },
  relevanceStage: InterpretationResultPersistenceRecord["indicators"][number]["relevanceStage"],
): string | null {
  if (relevanceStage === "output") {
    return activity.output;
  }
  if (relevanceStage === "outcome" || relevanceStage === "impact") {
    return activity.outcome;
  }
  return null;
}

// Cross-evidence-linkage-design.md §9/§15.2(G): the goal-verdict compiler
// linkageIndicatorCalculations.ts's own comment flags as not yet built
// would require matching a goal's wording to a computed field/bucket by
// text — a heuristic this function deliberately does not invent. Instead
// it only surfaces indicators ia_python_service already flagged, at
// extraction time, as directly measuring a stated goal
// (matchesStatedGoal), so "which number goes with which goal" is never
// guessed here. An indicator is skipped (not defaulted) whenever its
// goal text carries no extractable number, since metGoal is a required
// field on the wire and a made-up verdict would be worse than omitting it.
function buildAiKnowledgeIndicatorInputs(
  results: InterpretationResultPersistenceRecord[],
  activity: { output: string | null; outcome: string | null },
): AiKnowledgeIndicatorInput[] {
  const inputs: AiKnowledgeIndicatorInput[] = [];

  for (const result of results) {
    for (const indicator of result.indicators) {
      if (
        !isIncludedInAiKnowledge(indicator.status) ||
        !indicator.matchesStatedGoal ||
        !indicator.computedValue ||
        typeof indicator.computedValue.value !== "number"
      ) {
        continue;
      }

      const goalText = goalTextForIndicatorRelevanceStage(
        activity,
        indicator.relevanceStage,
      );
      const goalGap = goalText
        ? computeGoalGap(goalText, indicator.computedValue.value)
        : null;
      if (!goalGap) {
        continue;
      }

      inputs.push({
        label: indicator.name,
        value: indicator.computedValue.value,
        denominator:
          indicator.computedValue.recordsIncluded +
          indicator.computedValue.recordsExcluded,
        target: goalGap.target,
        metGoal: AI_KNOWLEDGE_GOAL_VERDICT_TO_MET_GOAL[goalGap.verdict],
      });
    }
  }

  return inputs;
}

// Tier B conflicts (§4) carry every competing value, not just a pair, so a
// conflict with 3+ disagreeing sources is reported as one contradiction
// per source paired against the first (kept) value, rather than dropped
// or silently narrowed to two.
function buildAiKnowledgeContradictionInputs(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
): AiKnowledgeContradictionInput[] {
  if (!linkageResult) {
    return [];
  }

  const inputs: AiKnowledgeContradictionInput[] = [];
  for (const group of linkageResult.groups) {
    for (const conflict of group.conflicts) {
      const [firstValue, ...competingValues] = conflict.competingValues;
      if (!firstValue) {
        continue;
      }
      for (const competingValue of competingValues) {
        inputs.push({
          entityName: conflict.entityKey,
          fieldOrTopic: conflict.fieldName,
          valueA: firstValue.value,
          sourceA: firstValue.sourceTableName,
          valueB: competingValue.value,
          sourceB: competingValue.sourceTableName,
        });
      }
    }
  }

  return inputs;
}

function buildAiKnowledgeCoverageIssueInputs(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
): AiKnowledgeCoverageIssueInput[] {
  if (!linkageResult) {
    return [];
  }

  const inputs: AiKnowledgeCoverageIssueInput[] = [];
  for (const group of linkageResult.groups) {
    const prevalences = computeCohortFlagPrevalences(
      group.entities,
      group.positiveStatusFieldDefinitions,
    );

    for (const prevalence of prevalences) {
      if (prevalence.flaggedCount === 0) {
        continue;
      }

      inputs.push({
        cohortLabel: `${prevalence.cohortFieldName}: ${prevalence.cohortValueLabel}`,
        cohortSize: prevalence.cohortSize,
        flagLabel: prevalence.flagFieldName,
        flagCount: prevalence.flaggedCount,
        flagShare: prevalence.ratio,
      });
    }
  }

  return inputs;
}

function buildActivityAiKnowledgeDrafts(
  results: InterpretationResultPersistenceRecord[],
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  language: "de" | "en",
): ActivityAiKnowledgeDraft[] {
  const goalRelevantFindings = deduplicateInsights(
    results
      .flatMap((result) =>
        result.qualitativeFindings
          .filter(
            (finding) =>
              isIncludedInAiKnowledge(finding.status) &&
              isGoalRelevantFinding(finding),
          )
          .map((finding) => ({
            id: finding.id,
            sourceType: "qualitative_finding" as const,
            text: finding.summary,
            isGoalRelevant: true,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: finding.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence),
  );

  const contextOnlyFindings = deduplicateInsights(
    results
      .flatMap((result) =>
        result.qualitativeFindings
          .filter(
            (finding) =>
              isIncludedInAiKnowledge(finding.status) &&
              !isGoalRelevantFinding(finding),
          )
          .map((finding) => ({
            id: finding.id,
            sourceType: "qualitative_finding" as const,
            text: finding.summary,
            isGoalRelevant: false,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: finding.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, MAX_CONTEXT_ONLY_FINDINGS),
  );

  const goalAlignmentGaps = deduplicateInsights(
    results.flatMap((result) =>
      result.goalAlignment
        .filter((coverage) => !coverage.isSupportedByData)
        .map((coverage) => ({
          id: coverage.id,
          sourceType: "goal_alignment" as const,
          text: coverage.gapExplanation ?? coverage.goalSummary,
          isGoalRelevant: true,
          sourceUploadMetadataIds: [result.uploadMetadataId],
          confidence: 0.75,
        })),
    ),
  );

  const goalRelevantIndicators = deduplicateInsights(
    results
      .flatMap((result) =>
        result.indicators
          .filter(
            (indicator) =>
              isIncludedInAiKnowledge(indicator.status) &&
              (indicator.matchesStatedGoal ||
                indicator.relevanceStage === "outcome" ||
                indicator.relevanceStage === "impact"),
          )
          .map((indicator) => ({
            id: indicator.id,
            sourceType: "indicator" as const,
            text: indicator.name,
            isGoalRelevant: true,
            sourceUploadMetadataIds: [result.uploadMetadataId],
            confidence: indicator.confidence,
          })),
      )
      .sort((left, right) => right.confidence - left.confidence),
  );

  const distributionSignals = deduplicateInsights([
    ...buildDistributionSignalDrafts(
      analysesByInterpretationResultId,
      language,
    ),
    ...buildLinkageCrossFileCrosstabDrafts(linkageResult, language),
  ]);

  // §10 of the design doc: extend the existing ranking/capping mechanism
  // rather than building a second one. Coverage issues outrank generic
  // qualitative findings; contradictions rank alongside them, since both
  // are the new, higher-value fact classes this feature exists to surface.
  const linkageCoverageIssues = buildLinkageCoverageIssueDrafts(
    linkageResult,
    language,
  );
  const linkageContradictions = buildLinkageContradictionDrafts(
    linkageResult,
    language,
  );

  const goalRelevantDrafts = deduplicateInsights([
    ...goalRelevantFindings,
    ...goalAlignmentGaps,
    ...goalRelevantIndicators,
  ]);

  if (goalRelevantDrafts.length > 0) {
    return deduplicateInsights([
      ...linkageCoverageIssues,
      ...linkageContradictions,
      ...goalRelevantDrafts,
      ...distributionSignals,
      ...contextOnlyFindings,
    ]);
  }

  const goalAlignmentFallback = deduplicateInsights(
    results.flatMap((result) =>
      result.goalAlignment.map((coverage) => ({
        id: coverage.id,
        sourceType: "goal_alignment" as const,
        text: coverage.isSupportedByData
          ? coverage.goalSummary
          : (coverage.gapExplanation ?? coverage.goalSummary),
        isGoalRelevant: true,
        sourceUploadMetadataIds: [result.uploadMetadataId],
        confidence: coverage.isSupportedByData ? 1 : 0.75,
      })),
    ),
  );

  return deduplicateInsights([
    ...linkageCoverageIssues,
    ...linkageContradictions,
    ...goalAlignmentFallback,
    ...distributionSignals,
    ...contextOnlyFindings,
  ]);
}

// Reachable only once generateAiKnowledgeSummaryText has already confirmed
// there's real grounded content (see the early-return above it) — the LLM
// call itself failed or returned nothing usable. Deliberately does NOT
// fall back to concatenating raw insight text: that text is written to be
// LLM input (raw field/table names, snake_case identifiers), not something
// a non-technical reviewer should ever see verbatim.
function buildAiKnowledgeSummaryFallback(language: "de" | "en"): string {
  return language === "de"
    ? "Für diese Aktivität konnte aktuell keine automatische Zusammenfassung erstellt werden."
    : "We couldn't generate an automatic summary for this activity right now.";
}

export class InterpretationService {
  constructor(
    private readonly uploadMetadataRepository: UploadMetadataRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly pythonProcessingClient: PythonProcessingClient,
    private readonly logger: FastifyBaseLogger,
    private readonly datasetPreparationService: DatasetPreparationService,
    private readonly deterministicAnalysisService: DeterministicAnalysisService,
    private readonly quantitativeInterpretationSynthesisService: QuantitativeInterpretationSynthesisService,
    private readonly projectKnowledgeBuilderService: ProjectKnowledgeBuilderService,
    private readonly projectLlmTokenLedgerService: ProjectLlmTokenLedgerService,
    private readonly evidenceLinkageReconciliationService: EvidenceLinkageReconciliationService,
    private readonly activityEvidenceLinkageResultRepository: ActivityEvidenceLinkageResultRepository,
  ) {}

  private async generateAiKnowledgeSummaryText(input: {
    scope: "activity" | "project";
    projectId: string;
    subjectName: string;
    interpretedEvidenceCount: number;
    insights: Array<{
      text: string;
      isGoalRelevant: boolean;
      activityName?: string;
    }>;
    language: "de" | "en";
    acknowledgedActivityCount?: number;
    activityGoals?: {
      activityType: string | null;
      objectives: string | null;
      output: string | null;
      outcome: string | null;
    } | null;
    projectGoals?: {
      projectGoal: string | null;
      impactModel: {
        inputs: string | null;
        activities: string | null;
        outputs: string | null;
        outcomes: string | null;
        impact: string | null;
      } | null;
      successIndicators: string | null;
    } | null;
    indicators?: AiKnowledgeIndicatorInput[];
    contradictions?: AiKnowledgeContradictionInput[];
    coverageIssues?: AiKnowledgeCoverageIssueInput[];
  }): Promise<string> {
    const indicators = input.indicators ?? [];
    const contradictions = input.contradictions ?? [];
    const coverageIssues = input.coverageIssues ?? [];

    if (
      input.insights.length === 0 &&
      indicators.length === 0 &&
      contradictions.length === 0 &&
      coverageIssues.length === 0
    ) {
      return "";
    }

    try {
      const summary =
        await this.pythonProcessingClient.generateAiKnowledgeSummary({
          scope: input.scope,
          subjectName: input.subjectName,
          interpretedEvidenceCount: input.interpretedEvidenceCount,
          acknowledgedActivityCount: input.acknowledgedActivityCount,
          insights: input.insights.map((insight) => ({
            text: insight.text,
            isGoalRelevant: insight.isGoalRelevant,
            activityName: insight.activityName,
          })),
          language: input.language,
          activityGoals: input.activityGoals,
          projectGoals: input.projectGoals,
          indicators,
          contradictions,
          coverageIssues,
        });
      await this.projectLlmTokenLedgerService.recordUsage(
        input.projectId,
        summary.llmUsage ?? null,
        databaseSession,
      );
      return (
        summary.summaryText.trim() ||
        buildAiKnowledgeSummaryFallback(input.language)
      );
    } catch (error) {
      this.logger.error(
        { err: error, scope: input.scope, subjectName: input.subjectName },
        "Failed to generate AI knowledge summary text.",
      );
      return buildAiKnowledgeSummaryFallback(input.language);
    }
  }

  private mapActivityAiKnowledgeRecord(
    activity: {
      id: string;
      name: string;
      aiKnowledgeSnapshot?: ActivityAiKnowledgeSnapshotPersistenceRecord | null;
    },
    projectId: string,
  ): ActivityAiKnowledgeRecord {
    const snapshot = activity.aiKnowledgeSnapshot;

    if (!snapshot) {
      throw new AppError(
        "This activity has no generated AI knowledge yet.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    return {
      activityId: activity.id,
      projectId,
      activityName: activity.name,
      interpretedEvidenceCount: snapshot.interpretedEvidenceCount,
      totalEvidenceCount: snapshot.totalEvidenceCount,
      generatedAt: snapshot.generatedAt.toISOString(),
      summaryText: snapshot.summaryText,
      insights: snapshot.insights.map((insight) => ({
        id: insight.id,
        sourceType: insight.sourceType,
        text: insight.text,
        isGoalRelevant: insight.isGoalRelevant,
        sourceUploadMetadataIds: [...insight.sourceUploadMetadataIds],
      })),
    };
  }

  private async buildActivityAiKnowledgeSnapshot(input: {
    activity: {
      id: string;
      name: string;
      activityType: string | null;
      objectives: string | null;
      output: string | null;
      outcome: string | null;
    };
    project: {
      id: string;
      projectGoal: string | null;
      impactModel: {
        inputs: string | null;
        activities: string | null;
        outputs: string | null;
        outcomes: string | null;
        impact: string | null;
      } | null;
      successIndicators: string | null;
    };
    uploads: Array<{ id: string }>;
    results: InterpretationResultPersistenceRecord[];
    linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null;
    language: "de" | "en";
  }): Promise<ActivityAiKnowledgeSnapshotPersistenceRecord> {
    const deterministicAnalyses =
      await this.deterministicAnalysisService.findByInterpretationResultIds(
        input.results.map((result) => result.id),
      );
    const deterministicAnalysisByInterpretationResultId = new Map(
      deterministicAnalyses.map((analysis) => [
        analysis.interpretationResultId,
        analysis,
      ]),
    );
    const { linkageResult } = input;
    const insightDrafts = buildActivityAiKnowledgeDrafts(
      input.results,
      deterministicAnalysisByInterpretationResultId,
      linkageResult,
      input.language,
    );
    const insights = insightDrafts.map((draft) => ({
      id: draft.id,
      sourceType: draft.sourceType,
      text: draft.text,
      isGoalRelevant: draft.isGoalRelevant,
      sourceUploadMetadataIds: draft.sourceUploadMetadataIds,
    }));

    const indicators = buildAiKnowledgeIndicatorInputs(
      input.results,
      input.activity,
    );
    const contradictions = buildAiKnowledgeContradictionInputs(linkageResult);
    const coverageIssues = buildAiKnowledgeCoverageIssueInputs(linkageResult);

    // Once any of indicators/contradictions/coverageIssues is non-empty,
    // ia_python_service switches to the structured prompt, which already
    // states every contradiction/coverage issue as its own JSON record —
    // repeating them again as prose insight text would just spend the
    // structured prompt's "at most two additional insights" allowance on
    // facts it already has, crowding out qualitative findings and goal
    // gaps that have no structured equivalent yet.
    const supplementaryInsights = insightDrafts.filter(
      (draft) =>
        draft.sourceType !== "linkage_contradiction" &&
        draft.sourceType !== "linkage_coverage_issue",
    );

    const summaryText = await this.generateAiKnowledgeSummaryText({
      scope: "activity",
      projectId: input.project.id,
      subjectName: input.activity.name,
      interpretedEvidenceCount: input.results.length,
      insights: supplementaryInsights,
      language: input.language,
      activityGoals: {
        activityType: input.activity.activityType,
        objectives: input.activity.objectives,
        output: input.activity.output,
        outcome: input.activity.outcome,
      },
      projectGoals: {
        projectGoal: input.project.projectGoal,
        impactModel: input.project.impactModel,
        successIndicators: input.project.successIndicators,
      },
      indicators,
      contradictions,
      coverageIssues,
    });

    return {
      generatedAt: new Date(),
      summaryText,
      interpretedEvidenceCount: input.results.length,
      totalEvidenceCount: input.uploads.length,
      insights,
    };
  }

  async startInterpretation(
    userId: string,
    uploadMetadataId: string,
    language: "de" | "en",
  ): Promise<StartInterpretationResponse> {
    const uploadMetadata = await this.uploadMetadataRepository.findById(
      uploadMetadataId,
      databaseSession,
    );

    if (!uploadMetadata) {
      throw new AppError(
        "Evidence record not found.",
        404,
        "evidence_not_found",
      );
    }

    const { project } = await this.authorizationService.canEditProject(
      userId,
      uploadMetadata.projectId,
    );

    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (!privacySafeRepresentation) {
      throw new AppError(
        "This evidence has not completed privacy-safe processing yet.",
        409,
        "privacy_safe_representation_not_available",
      );
    }

    const evidenceModality = classifyEvidenceModalityFromPayload(
      privacySafeRepresentation.payload,
    );
    const interpretationSupportState =
      getEvidenceModalitySupportState(evidenceModality);

    if (!isEvidenceModalitySupported(evidenceModality)) {
      throw new AppError(
        interpretationSupportState === "insufficiently_extracted"
          ? "This evidence does not contain enough extracted structure for reliable interpretation."
          : "This evidence was parsed successfully, but its current modality is not yet supported for canonical interpretation.",
        409,
        interpretationSupportState === "insufficiently_extracted"
          ? "interpretation_data_type_insufficiently_extracted"
          : "interpretation_data_type_not_supported_yet",
        { evidenceModality },
      );
    }

    const activeJob =
      await this.processingJobRepository.findActiveByUploadMetadataId(
        uploadMetadataId,
        databaseSession,
      );

    if (activeJob) {
      throw new AppError(
        "A processing job is already active for this evidence version.",
        409,
        "processing_job_already_active",
      );
    }

    const queuedJob = await this.processingJobRepository.create(
      {
        organizationId: uploadMetadata.organizationId,
        projectId: uploadMetadata.projectId,
        activityId: uploadMetadata.activityId,
        uploadMetadataId,
        triggeredById: userId,
        jobType: "dataset_interpretation",
        payload: {
          source: "phase_3_dataset_interpretation",
          privacySafeRepresentationId: privacySafeRepresentation.id,
          language,
        },
      },
      databaseSession,
    );

    this.logger.info(
      {
        processingJobId: queuedJob.id,
        uploadMetadataId,
        privacySafeRepresentationId: privacySafeRepresentation.id,
        language,
      },
      "starting dataset interpretation",
    );

    const activity = uploadMetadata.activityId
      ? await this.activityRepository.findById(
          uploadMetadata.activityId,
          databaseSession,
        )
      : null;

    if (uploadMetadata.activityId) {
      await clearActivityAiKnowledgeStateIfPresent(
        this.activityRepository,
        uploadMetadata.activityId,
        databaseSession,
      );
    }

    const updatedQueuedJob = await this.processingJobRepository.update(
      queuedJob.id,
      {
        payload: {
          ...(queuedJob.payload ?? {}),
          activityGoals: activity
            ? {
                activityType: activity.activityType,
                objectives: activity.objectives,
                output: activity.output,
                outcome: activity.outcome,
              }
            : null,
          projectGoals: {
            projectGoal: project.projectGoal,
            impactModel: project.impactModel,
            successIndicators: project.successIndicators,
          },
        },
      },
      databaseSession,
    );

    return { job: mapProcessingJob(updatedQueuedJob) };
  }

  async getByProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectInterpretationOverview> {
    const { project } = await this.authorizationService.canViewProject(
      userId,
      projectId,
    );

    const activities = await this.activityRepository.listByProject(
      project.id,
      databaseSession,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      activities.map((activity) => activity.id),
      databaseSession,
    );

    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const preparations =
      await this.datasetPreparationService.findByInterpretationResultIds(
        results.map((result) => result.id),
      );
    const deterministicAnalyses =
      await this.deterministicAnalysisService.findByInterpretationResultIds(
        results.map((result) => result.id),
      );
    const preparationByResultId = new Map(
      preparations.map((preparation) => [
        preparation.interpretationResultId,
        preparation,
      ]),
    );
    const deterministicAnalysisByResultId = new Map(
      deterministicAnalyses.map((analysis) => [
        analysis.interpretationResultId,
        analysis,
      ]),
    );

    return {
      results: results.map((result) =>
        mapInterpretationResult({
          ...result,
          datasetPreparation: preparationByResultId.get(result.id) ?? null,
          deterministicAnalysis:
            deterministicAnalysisByResultId.get(result.id) ?? null,
        }),
      ),
    };
  }

  async startActivityInterpretation(
    userId: string,
    activityId: string,
    language: "de" | "en",
  ): Promise<StartActivityInterpretationResponse> {
    await this.authorizationService.canEditActivity(userId, activityId);

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence to interpret.",
        409,
        "activity_interpretation_not_ready",
      );
    }

    const privacySafeRepresentations =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const latestResults =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const jobs = await this.processingJobRepository.listByActivity(
      activityId,
      databaseSession,
    );
    const privacySafeRepresentationByUploadId = new Map(
      privacySafeRepresentations.map((representation) => [
        representation.uploadMetadataId,
        representation,
      ]),
    );
    const latestJobByUploadId = getLatestJobByUploadMetadataId(jobs);
    const latestResultByUploadId = new Map(
      latestResults.map((result) => [result.uploadMetadataId, result]),
    );
    const activeUploadIds = new Set(
      [...latestJobByUploadId.values()]
        .filter(
          (job) =>
            job.status !== "completed" &&
            job.status !== "failed" &&
            job.status !== "cancelled",
        )
        .map((job) => job.uploadMetadataId),
    );

    const eligibleUploads = uploads.filter((upload) => {
      if (activeUploadIds.has(upload.id)) {
        return false;
      }
      if (latestResultByUploadId.has(upload.id)) {
        return false;
      }

      const privacySafeRepresentation = privacySafeRepresentationByUploadId.get(
        upload.id,
      );
      if (!privacySafeRepresentation) {
        return false;
      }

      const evidenceModality = classifyEvidenceModalityFromPayload(
        privacySafeRepresentation.payload,
      );
      return isEvidenceModalitySupported(evidenceModality);
    });

    if (eligibleUploads.length === 0) {
      const uploadStates = uploads.map((upload) => {
        const latestJob = latestJobByUploadId.get(upload.id) ?? null;
        const privacySafeRepresentation =
          privacySafeRepresentationByUploadId.get(upload.id) ?? null;
        const evidenceModality = privacySafeRepresentation
          ? classifyEvidenceModalityFromPayload(
              privacySafeRepresentation.payload,
            )
          : null;

        let reason:
          | "active_job"
          | "already_interpreted"
          | "privacy_safe_representation_missing"
          | "unsupported_modality";

        if (activeUploadIds.has(upload.id)) {
          reason = "active_job";
        } else if (latestResultByUploadId.has(upload.id)) {
          reason = "already_interpreted";
        } else if (!privacySafeRepresentation) {
          reason = "privacy_safe_representation_missing";
        } else {
          reason = "unsupported_modality";
        }

        return {
          uploadMetadataId: upload.id,
          originalFileName: upload.originalFileName,
          reason,
          latestJobStatus: latestJob?.status ?? null,
          latestJobType: latestJob?.jobType ?? null,
          evidenceModality,
        };
      });

      this.logger.warn(
        {
          activityId,
          uploadCount: uploads.length,
          activeUploadCount: activeUploadIds.size,
          uploadStates,
        },
        "Activity interpretation blocked because no evidence is ready for AI interpretation.",
      );

      throw new AppError(
        "No evidence in this activity is ready for AI interpretation yet.",
        409,
        "activity_interpretation_not_ready",
        { uploadStates },
      );
    }

    const jobsStarted = [];
    for (const upload of eligibleUploads) {
      const started = await this.startInterpretation(
        userId,
        upload.id,
        language,
      );
      jobsStarted.push(started.job);
    }

    return {
      jobs: jobsStarted,
      startedCount: jobsStarted.length,
      skippedCount: uploads.length - jobsStarted.length,
    };
  }

  async getActivityAiKnowledge(
    userId: string,
    activityId: string,
  ): Promise<ActivityAiKnowledgeRecord> {
    const { activity, project } =
      await this.authorizationService.canViewActivity(userId, activityId);

    return this.mapActivityAiKnowledgeRecord(activity, project.id);
  }

  async generateActivityAiKnowledge(
    userId: string,
    activityId: string,
    language: "de" | "en" = "en",
  ): Promise<ActivityAiKnowledgeRecord> {
    return this.generateOrRegenerateActivityAiKnowledge(
      userId,
      activityId,
      language,
      "create",
    );
  }

  /**
   * Explicit re-run: overwrites an existing aiKnowledgeSnapshot in place
   * with a freshly generated one, without requiring new evidence first.
   * Shares every precondition and the whole build/persist path with
   * generateActivityAiKnowledge — the only difference is which side of
   * the aiKnowledgeSnapshot-existence check is enforced.
   */
  async regenerateActivityAiKnowledge(
    userId: string,
    activityId: string,
    language: "de" | "en" = "en",
  ): Promise<ActivityAiKnowledgeRecord> {
    return this.generateOrRegenerateActivityAiKnowledge(
      userId,
      activityId,
      language,
      "replace",
    );
  }

  private async generateOrRegenerateActivityAiKnowledge(
    userId: string,
    activityId: string,
    language: "de" | "en",
    mode: "create" | "replace",
  ): Promise<ActivityAiKnowledgeRecord> {
    const { activity, project } =
      await this.authorizationService.canEditActivity(userId, activityId);

    if (mode === "create" && activity.aiKnowledgeSnapshot) {
      throw new AppError(
        "AI knowledge is already available for this activity. Use regenerate to replace it, or upload new evidence.",
        409,
        "activity_ai_knowledge_already_generated",
      );
    }

    if (mode === "replace" && !activity.aiKnowledgeSnapshot) {
      throw new AppError(
        "This activity has no AI knowledge yet. Generate it first.",
        409,
        "activity_ai_knowledge_not_generated_yet",
      );
    }

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence yet.",
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    const jobs = await this.processingJobRepository.listByActivity(
      activityId,
      databaseSession,
    );
    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    // §11 of the cross-evidence-linkage design: an activity with 2+ uploads
    // must not be treated as assessment-ready until evidence linkage has
    // had a chance to run for it. There is no persisted general lifecycle
    // state to gate this on (see the design doc's correction note), so
    // this consults computeActivityWorkflowStage — the same derivation
    // exposed read-only via getActivityWorkflowStage() — as the single
    // source of truth for every precondition below, rather than
    // re-deriving each one separately. EvidenceLinkageReconciliationService
    // persists a record (even an empty-groups one) for every activity it
    // successfully reconciles, so a missing record here means
    // reconciliation hasn't completed for the current evidence set yet.
    const linkageResult =
      uploads.length >= 2
        ? await this.activityEvidenceLinkageResultRepository.findByActivityId(
            activityId,
            databaseSession,
          )
        : null;

    const stage = computeActivityWorkflowStage({
      isAcknowledged: Boolean(activity.interpretationAcknowledgedAt),
      uploadIds: uploads.map((upload) => upload.id),
      jobs,
      results,
      hasLinkageResultIfApplicable: linkageResult !== null,
    });

    const notReadyMessageByStage: Partial<
      Record<ActivityWorkflowStage, string>
    > = {
      privacy_review:
        "Every evidence file must complete privacy review before AI knowledge is available.",
      analysis_running:
        "AI knowledge cannot be generated while interpretation is still running.",
      analysis_pending:
        "All evidence in this activity must finish interpretation before AI knowledge is available.",
      needs_clarification:
        "This activity still has unresolved clarification questions.",
      goal_review:
        "Evidence linkage across this activity's uploads has not finished yet. Try again in a moment.",
    };

    const notReadyMessage = notReadyMessageByStage[stage];
    if (notReadyMessage) {
      throw new AppError(
        notReadyMessage,
        409,
        "activity_ai_knowledge_not_ready",
      );
    }

    const aiKnowledgeSnapshot = await this.buildActivityAiKnowledgeSnapshot({
      activity,
      project,
      uploads,
      results,
      linkageResult,
      language,
    });

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        aiKnowledgeSnapshot,
        interpretationAcknowledgedAt: new Date(),
        interpretationAcknowledgedById: userId,
      },
      databaseSession,
    );

    try {
      await this.projectKnowledgeBuilderService.buildForProject(project.id);
    } catch (error) {
      this.logger.error(
        { projectId: project.id, activityId, error },
        "project knowledge model rebuild after AI knowledge generation failed",
      );
    }

    return this.mapActivityAiKnowledgeRecord(updatedActivity, project.id);
  }

  /**
   * Read-only, authoritative version of the workflow stage the webapp
   * currently only derives client-side (cross-evidence-linkage-design.md
   * §11). Computed fresh from current uploads/jobs/results/linkage state,
   * never stored, so it can't drift out of sync.
   */
  async getActivityWorkflowStage(
    userId: string,
    activityId: string,
  ): Promise<ActivityWorkflowStageRecord> {
    const { activity } = await this.authorizationService.canViewActivity(
      userId,
      activityId,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );

    if (uploads.length === 0) {
      return { activityId, stage: "no_evidence" };
    }

    const [jobs, results, linkageResult] = await Promise.all([
      this.processingJobRepository.listByActivity(activityId, databaseSession),
      this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      ),
      uploads.length >= 2
        ? this.activityEvidenceLinkageResultRepository.findByActivityId(
            activityId,
            databaseSession,
          )
        : Promise.resolve(null),
    ]);

    const stage = computeActivityWorkflowStage({
      isAcknowledged: Boolean(activity.interpretationAcknowledgedAt),
      uploadIds: uploads.map((upload) => upload.id),
      jobs,
      results,
      hasLinkageResultIfApplicable: linkageResult !== null,
    });

    return { activityId, stage };
  }

  async getById(userId: string, interpretationResultId: string) {
    const result = await this.interpretationResultRepository.findById(
      interpretationResultId,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "Interpretation result not found.",
        404,
        "interpretation_result_not_found",
      );
    }

    await this.authorizationService.canViewProject(userId, result.projectId);

    const datasetPreparation =
      await this.datasetPreparationService.findByInterpretationResultId(
        result.id,
      );
    const deterministicAnalysis =
      await this.deterministicAnalysisService.findByInterpretationResultId(
        result.id,
      );

    return mapInterpretationResult({
      ...result,
      datasetPreparation,
      deterministicAnalysis,
    });
  }

  async answerQuestion(
    userId: string,
    interpretationResultId: string,
    questionId: string,
    answeredValue: string,
  ) {
    const result = await this.interpretationResultRepository.findById(
      interpretationResultId,
      databaseSession,
    );

    if (!result) {
      throw new AppError(
        "Interpretation result not found.",
        404,
        "interpretation_result_not_found",
      );
    }

    await this.authorizationService.canEditProject(userId, result.projectId);

    const answeredQuestion = result.questions.find(
      (question) => question.id === questionId,
    );

    const updated = await this.interpretationResultRepository.answerQuestion(
      interpretationResultId,
      questionId,
      { answeredValue, answeredById: userId, answeredAt: new Date() },
      databaseSession,
    );

    if (!updated || !answeredQuestion) {
      throw new AppError(
        "This question was not found.",
        404,
        "interpretation_question_not_found",
      );
    }

    if (
      result.activityId &&
      ((answeredQuestion.status === "answered" &&
        answeredQuestion.answeredValue !== answeredValue &&
        isBlockingQuestion(answeredQuestion)) ||
        answeredQuestion.status !== "answered")
    ) {
      await clearActivityAiKnowledgeStateIfPresent(
        this.activityRepository,
        result.activityId,
        databaseSession,
      );
    }
    const datasetPreparation =
      await this.datasetPreparationService.syncForInterpretationResult(updated);
    const deterministicAnalysis =
      await this.deterministicAnalysisService.syncForInterpretationResult(
        updated,
        datasetPreparation,
      );
    const updatedPreparation =
      deterministicAnalysis.status === "ready"
        ? await this.datasetPreparationService.markAnalysisCompleted(
            datasetPreparation,
          )
        : datasetPreparation;
    const synthesized = await this.quantitativeInterpretationSynthesisService
      .maybeSyncForInterpretationResult(
        updated,
        updatedPreparation,
        deterministicAnalysis,
      )
      .catch((error: unknown) => {
        this.logger.error(
          {
            interpretationResultId: updated.id,
            questionId,
            error,
          },
          "quantitative interpretation synthesis could not be completed after a question answer",
        );
        return null;
      });

    if (updated.activityId) {
      await this.evidenceLinkageReconciliationService
        .reconcileForActivity(updated.activityId)
        .catch((error: unknown) => {
          this.logger.error(
            {
              activityId: updated.activityId,
              interpretationResultId: updated.id,
              questionId,
              error,
            },
            "evidence linkage reconciliation could not be completed after a question answer",
          );
        });
    }

    return mapInterpretationResult({
      ...(synthesized ?? updated),
      datasetPreparation: updatedPreparation,
      deterministicAnalysis,
    });
  }

  async acknowledgeReview(
    userId: string,
    activityId: string,
  ): Promise<ActivitySummary> {
    const { project } = await this.authorizationService.canEditActivity(
      userId,
      activityId,
    );

    const uploads = await this.uploadMetadataRepository.listByActivityIds(
      [activityId],
      databaseSession,
    );
    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );
    const privacySafeRepresentations =
      await this.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
        uploads.map((upload) => upload.id),
        databaseSession,
      );

    if (uploads.length === 0) {
      throw new AppError(
        "This activity has no evidence to acknowledge.",
        409,
        "interpretation_review_incomplete",
      );
    }

    if (privacySafeRepresentations.length !== uploads.length) {
      throw new AppError(
        "Every evidence file must complete privacy-safe processing before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
      );
    }

    const unsupportedEvidenceModalities = privacySafeRepresentations
      .map((representation) =>
        classifyEvidenceModalityFromPayload(representation.payload),
      )
      .filter(
        (evidenceModality) => !isEvidenceModalitySupported(evidenceModality),
      );

    if (unsupportedEvidenceModalities.length > 0) {
      throw new AppError(
        "Every evidence file must be on a supported evidence modality before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
        {
          unsupportedEvidenceModalities: [
            ...new Set(unsupportedEvidenceModalities),
          ],
        },
      );
    }

    if (results.length !== uploads.length) {
      throw new AppError(
        "Every evidence file must be interpreted before this activity can be acknowledged.",
        409,
        "interpretation_review_incomplete",
      );
    }

    // The frontend already disables its acknowledgment button while
    // blocking questions remain pending, but that's a UX nicety, not the
    // real guarantee — same principle as privacy review approval. The
    // backend remains the source of truth for review completeness.
    if (hasPendingBlockingQuestions(results)) {
      throw new AppError(
        "This activity still has unresolved clarification questions.",
        409,
        "interpretation_review_incomplete",
      );
    }

    const updatedActivity = await this.activityRepository.update(
      activityId,
      {
        interpretationAcknowledgedAt: new Date(),
        interpretationAcknowledgedById: userId,
      },
      databaseSession,
    );

    // Acknowledgment is exactly the "verified evidence update" event the
    // Project Knowledge Model's own design anticipated as the automatic
    // rebuild trigger (see "Phase 4 — Project Knowledge Model.md",
    // "Versioning and Rebuild Lifecycle" — rebuilds stay explicit/
    // event-driven, never on a timer or on every page view). A rebuild
    // failure must never fail the acknowledgment itself — acknowledgment
    // already succeeded and is valid regardless; the rebuild is a
    // best-effort downstream projection of it. AnalyticsExecutionService
    // also self-heals for any activity acknowledged before this existed.
    try {
      await this.projectKnowledgeBuilderService.buildForProject(project.id);
    } catch (error) {
      this.logger.error(
        { projectId: project.id, activityId, error },
        "project knowledge model rebuild after acknowledgment failed",
      );
    }

    return mapActivity(
      {
        ...updatedActivity,
        projectOwnerId: project.ownerId,
        projectStatus: project.status,
      },
      userId,
    );
  }
}
