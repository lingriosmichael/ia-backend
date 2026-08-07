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
  buildFieldDistributions,
  computeCohortFlagPrevalences,
  computeGoalGap,
  type LinkageGoalVerdict,
} from "../linkage/linkageIndicatorCalculations.js";
import type {
  AiKnowledgeContradictionInput,
  AiKnowledgeCoverageIssueInput,
  AiKnowledgeDistributionInput,
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

// §10.6 of the AI-knowledge audit: summarizing every bucket/segment/cell in
// a sentence doesn't scale, but silently keeping only the top 2 by count
// can hide the operationally important category (e.g. a small
// "needs follow-up" bucket buried under two large "resolved" ones). This
// keeps the count-based ranking — this codebase deliberately does not
// invent a semantic "which category matters more" heuristic, per §12 —
// but never drops entries silently: anything past the cap is named as an
// explicit remainder (how many categories, how many records) instead of
// vanishing.
const MAX_SUMMARIZED_ENTRIES = 4;

function summarizeTopEntries<T>(
  entriesSortedByCountDescending: T[],
  getCount: (entry: T) => number,
  formatEntry: (entry: T) => string,
  language: "de" | "en",
): string {
  const shown = entriesSortedByCountDescending.slice(0, MAX_SUMMARIZED_ENTRIES);
  const omitted = entriesSortedByCountDescending.slice(MAX_SUMMARIZED_ENTRIES);
  const summary = shown
    .map(formatEntry)
    .join(language === "de" ? ", gefolgt von " : ", followed by ");

  if (omitted.length === 0) {
    return summary;
  }

  const omittedCount = omitted.reduce((sum, entry) => sum + getCount(entry), 0);
  return language === "de"
    ? `${summary} sowie ${omitted.length} weitere Kategorien (${omittedCount} Einträge)`
    : `${summary}, plus ${omitted.length} more categories (${omittedCount} entries)`;
}

// Per-field category breakdowns (analysis.distributions) are reported as
// guaranteed AiKnowledgeDistributionInput records instead (see
// buildAiKnowledgeDistributionInputs below) — this function now only
// covers subgroup breakdowns (a segment's positive rate), which have no
// guaranteed-field equivalent yet and remain a discretionary insight the
// LLM may weave in.
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
    for (const breakdown of analysis.subgroupBreakdowns) {
      const meaningfulSegments = breakdown.segments
        .filter((segment) => segment.rowCount > 0)
        .sort((left, right) => right.rowCount - left.rowCount);
      if (meaningfulSegments.length < 2) {
        continue;
      }

      const segmentSummary = summarizeTopEntries(
        meaningfulSegments,
        (segment) => segment.rowCount,
        (segment) =>
          `${formatNullableCategoryValue(
            segment.value,
            language,
          )} ${formatCountOrPercent(
            segment.rowCount,
            segment.positiveRatio,
            language,
          )}`,
        language,
      );

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

// A raw column name (e.g. "fuehrungszeugnis_status") is exactly the kind
// of internal vocabulary §12/the AI-knowledge audit bans from user-facing
// text — previously papered over by routing every distribution bullet
// through the LLM's own VOCABULARY rules. Now that distribution bullets
// are rendered entirely in code (see ai_knowledge_summary.py's
// AiKnowledgeSummaryDraft docstring), there is no LLM rephrase step left to
// catch this, so the label itself must already be plain language before it
// leaves ia_backend. The semantic-interpretation stage already produces
// exactly this — InterpretationEntity.aiMeaning, one plain-language
// description per originalField, computed once per upload and persisted —
// so this reuses that instead of inventing a second labeling mechanism.
// Falls back to a minimally humanized field name only if that stage never
// ran or didn't cover this field, which should be rare in practice.
function resolveDistributionLabel(
  fieldName: string,
  sourceUploadMetadataId: string,
  results: InterpretationResultPersistenceRecord[],
): string {
  const aiMeaning = results
    .find((result) => result.uploadMetadataId === sourceUploadMetadataId)
    ?.entities?.find((entity) => entity.originalField === fieldName)
    ?.aiMeaning?.trim();
  if (aiMeaning) {
    return aiMeaning;
  }

  return fieldName
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

function summarizeDistributionBuckets(
  buckets: ReadonlyArray<{
    value: string | null;
    count: number;
    ratio: number | null;
  }>,
  language: "de" | "en",
): string | null {
  const meaningfulBuckets = buckets
    .filter((bucket) => bucket.count > 0)
    .sort((left, right) => right.count - left.count);
  if (meaningfulBuckets.length < 2) {
    return null;
  }

  const bucketSummary = summarizeTopEntries(
    meaningfulBuckets,
    (bucket) => bucket.count,
    (bucket) =>
      `${formatNullableCategoryValue(bucket.value, language)} ${formatCountOrPercent(
        bucket.count,
        bucket.ratio,
        language,
      )}`,
    language,
  );

  return language === "de"
    ? `die größten Anteile entfallen auf ${bucketSummary}`
    : `the largest shares are ${bucketSummary}`;
}

// Workstream A follow-up: a compliance/status field's collapsed positive
// count was already made a mandatory indicator (buildMandatoryStatusIndicatorInputs)
// because LLM metric-selection is not run-to-run stable, but the *rest* of
// that same field's category breakdown (e.g. "12 ausstehend, 3 abgelehnt")
// still only reached the summary as a discretionary insight competing for
// a capped "weave at most two" slot — so it could appear on one run and
// vanish on the next even though the underlying data never changed. This
// builds one guaranteed AiKnowledgeDistributionInput per meaningful
// distribution instead, so every category breakdown is now always
// complete, the same way indicators/contradictions/coverageIssues already
// are.
//
// August 6 2026 fix: a column's distribution must always be computed
// against the single cross-file joined entity table (linkageResult) when
// that column's upload participated in a join — never against that
// upload's own per-file analysis. Computing it per-file is what produced
// the reported bug: a column native to a file with its own internal
// duplicates totaled that file's raw row count (e.g. 79), while a column
// native to a file without internal duplicates totaled a different number
// (e.g. 75), inside the very same summary, even though every column
// describes the same 75 real, deduplicated entities. Only uploads that
// never joined with anything (e.g. a single-upload activity) still fall
// back to their own per-file analysis, since there is no joined table to
// compute against for them.
// Shared by every builder that must never compute a joined upload's own
// figure from that upload's raw per-file analysis (distributions, and the
// mandatory status indicator) — computed once per snapshot build so every
// builder agrees on exactly which uploads have a joined table to prefer.
function computeUploadIdsCoveredByLinkage(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
): ReadonlySet<string> {
  return new Set(
    (linkageResult?.groups ?? []).flatMap(
      (group) => group.linkedUploadMetadataIds,
    ),
  );
}

// August 6 2026 fix (PII gate): a raw field name naming a direct
// identifier concept — a person's name, an email address, a phone number,
// a postal address — must never have its individual values rendered as
// distribution "categories". For a field like an email address, where
// almost every value is unique, a "distribution" over it is not a
// category breakdown at all, it is a list of real personal data with a
// count of 1 attached to each entry. This is defense-in-depth,
// independent of whatever the upstream privacy-safe transformation
// pipeline did or didn't already tokenize — ia_python_service's own docs
// mark that pipeline's scope as deliberately narrow (PERSON and explicit
// ADDRESS fields only; email/phone are explicitly out of scope), and even
// an in-scope field can still reach here unredacted if a reviewer chose
// "keep" for it during privacy review. Matched against the raw field name
// only (never the goal text, never the label) — deliberately broad and
// keyword-based rather than clever, since the cost of over-suppressing a
// legitimately-safe field here is far lower than the cost of missing a
// real one.
const DIRECT_IDENTIFIER_FIELD_NAME_KEYWORDS: readonly string[] = [
  "name",
  "vorname",
  "nachname",
  "familienname",
  "geburtsname",
  "email",
  "e-mail",
  "mail",
  "telefon",
  "phone",
  "handy",
  "mobil",
  "adresse",
  "address",
  "strasse",
  "straße",
  "hausnummer",
  "plz",
  "postleitzahl",
];

function isDirectIdentifierFieldName(fieldName: string): boolean {
  const normalized = normalizeForTextMatch(fieldName).replace(/\s+/g, "");
  return DIRECT_IDENTIFIER_FIELD_NAME_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.replace(/\s+/g, "")),
  );
}

// The only thing a direct-identifier field is ever allowed to report:
// how many entries have any value on file for it, never which values.
function summarizeFieldCompleteness(
  nonNullCount: number,
  totalCount: number | null,
  language: "de" | "en",
): string {
  if (totalCount !== null) {
    return language === "de"
      ? `${nonNullCount} von ${totalCount} haben hierzu einen Wert hinterlegt`
      : `${nonNullCount} of ${totalCount} have a value on file for this`;
  }
  return language === "de"
    ? `${nonNullCount} Einträge haben hierzu einen Wert hinterlegt`
    : `${nonNullCount} entries have a value on file for this`;
}

// August 6 2026 fix (render-gate): "compute every column" (Fix #1) was
// never meant to also mean "surface every column" — nothing before this
// stood between the two, so a column with nothing to do with either
// stated goal (a topic-preference list, a home district) rendered as a
// top-level bullet with exactly the same weight as the one number that
// actually answers a goal. A field earns a bullet only if it resolves
// against a stated goal's own wording (goalTextReferencesField), or the
// same field name already feeds a Tier B contradiction or a cohort
// coverage record elsewhere in this same summary — both of which are
// already-guaranteed, already-goal-relevant facts computed from the exact
// same joined table. Everything else stays computed (still available for
// evidence drill-down) and stored, just never surfaced here.
function collectEvidenceRelevantFieldNames(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
): ReadonlySet<string> {
  const fieldNames = new Set<string>();
  for (const group of linkageResult?.groups ?? []) {
    for (const conflict of group.conflicts) {
      fieldNames.add(conflict.fieldName);
    }
    for (const prevalence of computeCohortFlagPrevalences(
      group.entities,
      group.positiveStatusFieldDefinitions,
    )) {
      fieldNames.add(prevalence.cohortFieldName);
      fieldNames.add(prevalence.flagFieldName);
    }
  }
  return fieldNames;
}

function buildAiKnowledgeDistributionInputs(
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  results: InterpretationResultPersistenceRecord[],
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  uploadIdsCoveredByLinkage: ReadonlySet<string>,
  relevantFieldNames: ReadonlySet<string>,
  language: "de" | "en",
): AiKnowledgeDistributionInput[] {
  const inputs: AiKnowledgeDistributionInput[] = [];

  // August 6 2026 fix: the render-gate for a *joined* field must be a
  // precise membership check against already-resolved facts — the same
  // field names buildMandatoryStatusIndicatorInputsFromLinkage actually
  // matched to a stated goal, plus whatever already feeds a contradiction
  // or coverage record — never an independent fresh text match against
  // this field's own label/values. A standalone match was tried first and
  // reintroduced the exact problem the gate exists to prevent: a generic
  // label like "Zeitliche Verfügbarkeit" shares ordinary vocabulary with
  // goal prose ("verfügbar") without there being any real, deliberate
  // resolution behind it, so it surfaced anyway.
  //
  // This only applies to joined fields. An unlinked upload has no goal
  // mapping, contradiction, or coverage-record mechanism to check
  // against at all (all three are inherently cross-file concepts), and
  // the reported bloat has only ever been about multi-file activities —
  // so, exactly like buildMandatoryStatusIndicatorInputs's own per-file
  // path, an unlinked upload's distributions keep surfacing
  // unconditionally, same as before any gate existed.
  for (const group of linkageResult?.groups ?? []) {
    for (const distribution of buildFieldDistributions(group.entities)) {
      if (!relevantFieldNames.has(distribution.fieldName)) {
        continue;
      }

      const label = resolveDistributionLabel(
        distribution.fieldName,
        distribution.sourceUploadMetadataId,
        results,
      );

      if (isDirectIdentifierFieldName(distribution.fieldName)) {
        inputs.push({
          label,
          summaryText: summarizeFieldCompleteness(
            distribution.totalEntityCount,
            group.entities.length,
            language,
          ),
        });
        continue;
      }

      const summaryText = summarizeDistributionBuckets(
        distribution.buckets,
        language,
      );
      if (!summaryText) {
        continue;
      }
      inputs.push({ label, summaryText });
    }
  }

  for (const [, analysis] of analysesByInterpretationResultId) {
    if (uploadIdsCoveredByLinkage.has(analysis.uploadMetadataId)) {
      continue;
    }

    for (const distribution of analysis.distributions) {
      const label = resolveDistributionLabel(
        distribution.columnName,
        analysis.uploadMetadataId,
        results,
      );

      if (isDirectIdentifierFieldName(distribution.columnName)) {
        const nonNullCount = distribution.buckets.reduce(
          (sum, bucket) => sum + bucket.count,
          0,
        );
        inputs.push({
          label,
          // No per-file row-total lookup is threaded through here — this
          // path only runs for uploads that never joined with anything,
          // a narrower and lower-priority case than the joined path above.
          summaryText: summarizeFieldCompleteness(nonNullCount, null, language),
        });
        continue;
      }

      const summaryText = summarizeDistributionBuckets(
        distribution.buckets,
        language,
      );
      if (!summaryText) {
        continue;
      }
      inputs.push({ label, summaryText });
    }
  }

  return inputs;
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
      const sortedCells = [...crosstab.cells].sort(
        (left, right) => right.count - left.count,
      );
      if (sortedCells.length === 0) {
        continue;
      }

      const cellSummary = summarizeTopEntries(
        sortedCells,
        (cell) => cell.count,
        (cell) =>
          `${cell.valueA} / ${cell.valueB} ${formatCountOrPercent(
            cell.count,
            cell.ratio,
            language,
          )}`,
        language,
      );

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

// The LLM has already judged which stage (output vs. outcome/impact) an
// indicator belongs to — but that stage's own activity field is often a
// blob of several distinct goal statements (see
// splitGoalTextIntoStatements), and the LLM never said *which one*. Rather
// than handing the whole blob to computeGoalGap (which previously grabbed
// a number from whichever statement happened to appear first — a wrong
// target stated with full confidence, not a missing one), this finds the
// one statement whose own wording actually names the indicator, the same
// literal-match discipline used everywhere else in this file. No
// statement matching is a normal, expected outcome — not every indicator
// is about a numbered goal — and correctly falls through to
// metGoal="unverifiable" below rather than guessing.
function goalTextForIndicatorRelevanceStage(
  activity: { output: string | null; outcome: string | null },
  relevanceStage: InterpretationResultPersistenceRecord["indicators"][number]["relevanceStage"],
  indicatorName: string,
): string | null {
  const wholeGoalText =
    relevanceStage === "output"
      ? activity.output
      : relevanceStage === "outcome" || relevanceStage === "impact"
        ? activity.outcome
        : null;
  if (!wholeGoalText) {
    return null;
  }

  return (
    splitGoalTextIntoStatements(wholeGoalText).find((statement) =>
      goalTextReferencesField(statement, [], indicatorName),
    ) ?? null
  );
}

// A single upload's indicators are always computed against that upload's
// own raw table (ia_python_service never sees the cross-file join), while
// linkageIndicatorCalculations.ts's cohort/distribution figures are always
// computed against the joined, Tier-A-deduplicated entity table. The two
// only agree when nothing was actually deduplicated for that upload — when
// they disagree, recomputing this indicator's numerator against the joined
// table would need the goal-verdict compiler design doc §15.2(G) itself
// flags as not yet built (matching a raw count's meaning to a specific
// joined-entity field by text). Rather than guess, this mirrors the same
// deduplicationConfidence signal ia_python_service's dashboard-curation
// path already uses (see analytics/models.py) so the summary prompt can
// caveat an unreconciled figure instead of presenting it with false
// precision alongside indicators that ARE deduplicated.
function computeIndicatorDenominatorBasis(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  uploadMetadataId: string,
  rawDenominator: number,
): "deduplicated" | "not_deduplicated_across_sources" | "not_applicable" {
  const group = linkageResult?.groups.find((candidate) =>
    candidate.linkedUploadMetadataIds.includes(uploadMetadataId),
  );
  if (!group) {
    return "not_applicable";
  }
  return group.entities.length === rawDenominator
    ? "deduplicated"
    : "not_deduplicated_across_sources";
}

// Cross-evidence-linkage-design.md §9/§15.2(G): the goal-verdict compiler
// linkageIndicatorCalculations.ts's own comment flags as not yet built
// would require matching a goal's wording to a computed field/bucket by
// text — a heuristic this function deliberately does not invent. Instead
// it only surfaces indicators ia_python_service already flagged, at
// extraction time, as directly measuring a stated goal
// (matchesStatedGoal), so "which number goes with which goal" is never
// guessed here. An indicator with a real computed value but no
// extractable goal target is still reported, with metGoal="unverifiable"
// and target=null, rather than silently dropped — a computed number is
// worth showing even when it can't be checked against a target, and
// dropping it made "no target found" indistinguishable from "target
// missed" once the bullet reached the LLM.
function buildAiKnowledgeIndicatorInputs(
  results: InterpretationResultPersistenceRecord[],
  activity: { output: string | null; outcome: string | null },
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
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

      const rawDenominator =
        indicator.computedValue.recordsIncluded +
        indicator.computedValue.recordsExcluded;
      const denominatorBasis = computeIndicatorDenominatorBasis(
        linkageResult,
        result.uploadMetadataId,
        rawDenominator,
      );

      const goalText = goalTextForIndicatorRelevanceStage(
        activity,
        indicator.relevanceStage,
        indicator.name,
      );
      const goalGap = goalText
        ? computeGoalGap(goalText, indicator.computedValue.value)
        : null;

      inputs.push({
        label: indicator.name,
        value: indicator.computedValue.value,
        denominator: rawDenominator,
        denominatorBasis,
        target: goalGap?.target ?? null,
        metGoal: goalGap
          ? AI_KNOWLEDGE_GOAL_VERDICT_TO_MET_GOAL[goalGap.verdict]
          : "unverifiable",
      });
    }
  }

  return inputs;
}

function normalizeForTextMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ü/g, "ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/[_-]+/g, " ")
    .trim();
}

// August 6 2026 fix: activity.output/activity.outcome are each a single
// free-text field that in practice concatenates several distinct
// Leistungsziele/Veränderungsziele, one per line — confirmed against a
// real activity: "Mindestens 70 Bewerbungen...\n65 geeignete
// Mentor:innen...\nFührungszeugnis-Prüfung für alle ausgewählten
// Mentor:innen einholen". Matching a field against the *whole* blob and
// then asking computeGoalGap to pull a target number out of that same
// blob is what let it grab "70" from the applications sentence and
// attach it to the Führungszeugnis goal, which has no number of its own
// at all — a wrong number stated with full confidence, not a missing
// one. Every goal-matching call site must split into individual
// statements first and match/extract against the one statement that
// actually mentions the field, never the whole field.
function splitGoalTextIntoStatements(goalText: string): string[] {
  return goalText
    .split(/\r?\n+/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// The deterministic half of a goal-to-column mapping (design doc §4.4):
// does this goal's own stated wording name one of this field's actual
// values (its confirmed positive value, or just one of its distribution's
// bucket values), or this field's own plain-language meaning? Deliberately
// literal substring containment only, never fuzzy/similarity scoring (the
// same principle linkageIndicatorCalculations.ts's Tier C canonicalization
// already applies) — a wrong guess here would misattribute one goal's
// target to an unrelated field with false confidence, which is worse than
// leaving the field unmatched. A short match (under 5 normalized
// characters) is rejected regardless of source, since a coincidental
// substring like "ja" or "ok" inside unrelated goal prose is not a
// meaningful signal. Shared by the mandatory-indicator goal match and the
// distribution render-gate below — both are "does this goal's wording
// name this field" checks, just against a different candidate value list.
function goalTextReferencesField(
  goalText: string,
  candidateValues: readonly string[],
  fieldLabel: string,
): boolean {
  const normalizedGoalText = normalizeForTextMatch(goalText);

  const matchesACandidateValue = candidateValues.some((value) => {
    const normalizedValue = normalizeForTextMatch(value);
    return (
      normalizedValue.length >= 5 &&
      normalizedGoalText.includes(normalizedValue)
    );
  });
  if (matchesACandidateValue) {
    return true;
  }

  return normalizeForTextMatch(fieldLabel)
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .some((word) => normalizedGoalText.includes(word));
}

// Once a field is confirmed matched to a goal's own wording, this decides
// what the resulting verdict actually is. A goal with an explicit numeric
// target ("65 geeignete Mentor:innen") reuses computeGoalGap's existing
// achieved/partly_achieved/not_achieved thresholds. A completion-style goal
// with no explicit number ("Führungszeugnis für alle Ausgewählte") has no
// target to compare a count against — but a confirmed match with zero
// occurrences of the field's own positive value is still a real, checkable
// failure, not an absence of data, so it is reported as "false" rather
// than "unverifiable". Any non-zero count with no explicit target stays
// "unverifiable": there is no way to tell from the goal's wording alone
// whether that count is "enough".
function classifyMatchedStatusFieldVerdict(
  goalText: string,
  positiveCount: number,
): {
  target: number | null;
  metGoal: "true" | "false" | "partial" | "unverifiable";
} {
  const goalGap = computeGoalGap(goalText, positiveCount);
  if (goalGap) {
    return {
      target: goalGap.target,
      metGoal: AI_KNOWLEDGE_GOAL_VERDICT_TO_MET_GOAL[goalGap.verdict],
    };
  }

  return {
    target: null,
    metGoal: positiveCount === 0 ? "false" : "unverifiable",
  };
}

// Whether a computed metric becomes a visible "indicator" is an LLM
// selection step (ia_python_service's quantitative/mixed synthesis picks
// at most 6 metric keys per activity) — and that step runs at an
// effectively elevated sampling temperature for reasoning-tier models
// (OpenAI does not support temperature=0 for them), so selection is not
// reliably consistent run to run even on identical input. A compliance
// field's positive-status count/ratio is exactly the kind of fact that
// must never depend on that coin flip, so it's built here unconditionally
// from the deterministic metric ia_backend already always computes
// (buildPrimaryStatusMetricsAndCandidates), independent of whether the
// LLM happened to pick it this run.
//
// Only covers uploads that never joined with anything — an upload
// participating in a linkage group has its mandatory status indicator
// computed by buildMandatoryStatusIndicatorInputsFromLinkage instead,
// against the joined table, for the exact same reason Fix #1 moved
// distributions off per-file analysis: a per-file denominator for a joined
// upload can silently disagree with every other joined field's entity
// count in the same summary.
function buildMandatoryStatusIndicatorInputs(
  analysesByInterpretationResultId: ReadonlyMap<
    string,
    DeterministicAnalysisPersistenceRecord
  >,
  results: InterpretationResultPersistenceRecord[],
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  uploadIdsCoveredByLinkage: ReadonlySet<string>,
): AiKnowledgeIndicatorInput[] {
  const inputs: AiKnowledgeIndicatorInput[] = [];

  for (const [
    interpretationResultId,
    analysis,
  ] of analysesByInterpretationResultId) {
    if (uploadIdsCoveredByLinkage.has(analysis.uploadMetadataId)) {
      continue;
    }

    const result = results.find(
      (candidate) => candidate.id === interpretationResultId,
    );
    const alreadySelectedMetricKeys = new Set(
      (result?.indicators ?? [])
        .map(
          (indicator) =>
            indicator.computedValue?.components?.deterministicAnalysisMetricKey,
        )
        .filter(
          (metricKey): metricKey is string => typeof metricKey === "string",
        ),
    );

    for (const metric of analysis.metrics) {
      if (
        metric.kind !== "ratio" ||
        !metric.metricKey.endsWith("::positive_status_ratio") ||
        alreadySelectedMetricKeys.has(metric.metricKey)
      ) {
        continue;
      }

      const numeratorCount = metric.components.numeratorCount;
      const denominatorCount = metric.components.denominatorCount;
      if (
        typeof numeratorCount !== "number" ||
        typeof denominatorCount !== "number"
      ) {
        continue;
      }

      inputs.push({
        label: resolveDistributionLabel(
          metric.sourceColumns[0] ?? metric.label,
          analysis.uploadMetadataId,
          results,
        ),
        value: numeratorCount,
        denominator: denominatorCount,
        denominatorBasis: computeIndicatorDenominatorBasis(
          linkageResult,
          analysis.uploadMetadataId,
          denominatorCount,
        ),
        // Deliberately not goal-matched here (unlike the linkage-sourced
        // path below): a per-file metric's components carry no confirmed
        // positiveStatusValues text to match against a goal's wording, and
        // guessing from the label alone risks the same misattribution this
        // whole mechanism exists to avoid.
        target: null,
        metGoal: "unverifiable",
      });
    }
  }

  return inputs;
}

// The goal-to-column mapping itself (design doc §4.4, §15.2(G)): closes
// the exact gap reported live — a distribution correctly computes a
// field's positive count (e.g. 20 of 75 marked geeignet), but nothing
// connected that number to the goal whose own wording names it, so the
// generated summary said no structured count existed for that goal at all
// despite the number sitting one section below it. Only fields with a
// confirmed positiveStatusValues definition are candidates (from
// group.positiveStatusFieldDefinitions, the same manifest
// computeCohortFlagPrevalences already uses), computed directly against
// the joined entity table so its denominator is always the reconciled
// entity count, never a raw per-file row count.
interface MandatoryLinkageIndicatorResult {
  inputs: AiKnowledgeIndicatorInput[];
  // Every fieldName this function actually matched to a stated goal —
  // the deliberate, resolved half of the goal-to-column mapping. This is
  // exactly what buildAiKnowledgeDistributionInputs's render-gate should
  // check against for "does this column resolve against the goal
  // mapping," rather than re-running its own independent text match.
  goalMappedFieldNames: ReadonlySet<string>;
}

function buildMandatoryStatusIndicatorInputsFromLinkage(
  linkageResult: ActivityEvidenceLinkageResultPersistenceRecord | null,
  results: InterpretationResultPersistenceRecord[],
  activity: { output: string | null; outcome: string | null },
): MandatoryLinkageIndicatorResult {
  const inputs: AiKnowledgeIndicatorInput[] = [];
  const goalMappedFieldNames = new Set<string>();
  // Individual goal statements, not the two whole output/outcome blobs —
  // see splitGoalTextIntoStatements's own comment for why matching (and
  // then extracting a number from) the whole blob is unsafe.
  const candidateGoalTexts = [activity.output, activity.outcome]
    .filter((goalText): goalText is string => Boolean(goalText))
    .flatMap(splitGoalTextIntoStatements);

  for (const group of linkageResult?.groups ?? []) {
    for (const definition of group.positiveStatusFieldDefinitions) {
      const positiveValues = new Set(
        definition.positiveStatusValues.map((value) =>
          value.trim().toLowerCase(),
        ),
      );

      let positiveCount = 0;
      let denominator = 0;
      for (const entity of group.entities) {
        const value = entity.fields.find(
          (field) => field.fieldName === definition.fieldName,
        )?.value;
        if (value === undefined) {
          continue;
        }
        denominator += 1;
        if (positiveValues.has(value)) {
          positiveCount += 1;
        }
      }
      if (denominator === 0) {
        continue;
      }

      const label = resolveDistributionLabel(
        definition.fieldName,
        definition.sourceUploadMetadataId,
        results,
      );
      const matchedGoalText = candidateGoalTexts.find((goalText) =>
        goalTextReferencesField(
          goalText,
          definition.positiveStatusValues,
          label,
        ),
      );
      if (matchedGoalText) {
        goalMappedFieldNames.add(definition.fieldName);
      }
      const { target, metGoal } = matchedGoalText
        ? classifyMatchedStatusFieldVerdict(matchedGoalText, positiveCount)
        : { target: null, metGoal: "unverifiable" as const };

      inputs.push({
        label,
        value: positiveCount,
        denominator,
        // Computed directly from the joined entities, so it is always
        // reconciled by construction — never the raw-per-file case
        // computeIndicatorDenominatorBasis exists to detect.
        denominatorBasis: "deduplicated",
        target,
        metGoal,
      });
    }
  }

  return { inputs, goalMappedFieldNames };
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

  // August 6 2026 fix (Workstream E's bloat problem, inverted): every
  // column's subgroup/crosstab breakdown is still computed here regardless
  // — genuinely useful for evidence drill-down — but a breakdown for a
  // field no goal cares about (e.g. a mentee topic-preference list) must
  // not compete for attention with the two numbers that actually answer a
  // stated goal. Neither builder below currently has a mechanism to mark
  // its own output goal-relevant, so this keeps every one of them computed
  // and available while filtering the surfaced/persisted set down to only
  // the ones that are (today: none, until a relevance signal exists for
  // this specific shape) — never a silent, unconditional top-level bullet
  // for every column regardless of whether it means anything to a goal.
  const allDistributionSignals = deduplicateInsights([
    ...buildDistributionSignalDrafts(
      analysesByInterpretationResultId,
      language,
    ),
    ...buildLinkageCrossFileCrosstabDrafts(linkageResult, language),
  ]);
  const distributionSignals = allDistributionSignals.filter(
    (draft) => draft.isGoalRelevant,
  );

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
    distributions?: AiKnowledgeDistributionInput[];
  }): Promise<string> {
    const indicators = input.indicators ?? [];
    const contradictions = input.contradictions ?? [];
    const coverageIssues = input.coverageIssues ?? [];
    const distributions = input.distributions ?? [];

    if (
      input.insights.length === 0 &&
      indicators.length === 0 &&
      contradictions.length === 0 &&
      coverageIssues.length === 0 &&
      distributions.length === 0
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
          distributions,
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

    const uploadIdsCoveredByLinkage =
      computeUploadIdsCoveredByLinkage(linkageResult);
    const mandatoryLinkageIndicators =
      buildMandatoryStatusIndicatorInputsFromLinkage(
        linkageResult,
        input.results,
        input.activity,
      );
    const indicators = [
      ...buildAiKnowledgeIndicatorInputs(
        input.results,
        input.activity,
        linkageResult,
      ),
      ...buildMandatoryStatusIndicatorInputs(
        deterministicAnalysisByInterpretationResultId,
        input.results,
        linkageResult,
        uploadIdsCoveredByLinkage,
      ),
      ...mandatoryLinkageIndicators.inputs,
    ];
    const contradictions = buildAiKnowledgeContradictionInputs(linkageResult);
    const coverageIssues = buildAiKnowledgeCoverageIssueInputs(linkageResult);
    const relevantFieldNames = new Set([
      ...collectEvidenceRelevantFieldNames(linkageResult),
      ...mandatoryLinkageIndicators.goalMappedFieldNames,
    ]);
    const distributions = buildAiKnowledgeDistributionInputs(
      deterministicAnalysisByInterpretationResultId,
      input.results,
      linkageResult,
      uploadIdsCoveredByLinkage,
      relevantFieldNames,
      input.language,
    );

    // Once any of indicators/contradictions/coverageIssues/distributions is
    // non-empty, ia_python_service switches to the structured prompt, which
    // already states every contradiction/coverage issue/distribution as its
    // own JSON record — repeating them again as prose insight text would
    // just spend the structured prompt's "at most two additional insights"
    // allowance on facts it already has, crowding out qualitative findings
    // and goal gaps that have no structured equivalent yet.
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
      distributions,
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

    // August 6 2026 fix: a hard invariant, independent of the stage
    // classification above — including its "reviewed" branch, which
    // exists so an already-acknowledged activity isn't re-blocked by a
    // newly-appeared clarification question, and was never meant to also
    // bypass this. Every current upload must have a current
    // interpretation result before a snapshot is built, full stop.
    // Skipping this once produced a real, observed bug: a snapshot
    // silently built from a stale linkage record while results.length
    // was 0 — reporting "1 insight from 0 evidence files" and rendering a
    // fully-formed summary as if that were a normal, complete result,
    // rather than refusing outright. Never trust that an acknowledged
    // activity's evidence is still the same evidence it was reviewed
    // against.
    if (results.length !== uploads.length) {
      throw new AppError(
        "All evidence in this activity must finish interpretation before AI knowledge is available.",
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
    // Failure here (e.g. the python-service call timing out) is caught and
    // persisted as a visible synthesisStatus on the result itself by
    // QuantitativeInterpretationSynthesisService — not swallowed. Anything
    // that escapes this call is a genuinely unexpected failure and should
    // propagate rather than be hidden behind a null fallback.
    const synthesized =
      await this.quantitativeInterpretationSynthesisService.maybeSyncForInterpretationResult(
        updated,
        updatedPreparation,
        deterministicAnalysis,
      );

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
