import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { AppError } from "../../shared/errors/appError.js";
import {
  interpretationQuestionCodeValues,
  interpretationQuestionKindValues,
} from "../../shared/contracts.js";
import type {
  EpistemicRole,
  ImpactIndicatorTileFormat,
  InterpretationQuestionCode,
  InterpretationQuestionKind,
  LlmUsageSummary,
  PrivacyReviewDecisions,
  PreparedDatasetMetricKind,
  PreparedDatasetValueScope,
} from "../../shared/contracts.js";

interface PythonProcessingJobStatusResponse {
  externalJobId: string;
  status:
    | "accepted"
    | "processing"
    | "awaiting_privacy_review"
    | "transforming"
    | "completed"
    | "failed"
    | "cancelled";
  updatedAt: string;
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}

interface ApprovePrivacyReviewResponse {
  externalJobId: string;
  status: "transforming" | "completed";
  updatedAt: string;
  details?: Record<string, unknown> | null;
}

interface StartDatasetInterpretationActivityGoals {
  activityType: string | null;
  objectives: string | null;
  output: string | null;
}

interface StartDatasetInterpretationProjectImpactModel {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
}

interface StartDatasetInterpretationProjectGoals {
  projectGoal: string | null;
  impactModel: StartDatasetInterpretationProjectImpactModel | null;
  successIndicators: string | null;
}

interface StartDatasetInterpretationInput {
  processingJobId: string;
  privacySafeRepresentationId: string;
  payload: Record<string, unknown>;
  language: "de" | "en";
  activityGoals: StartDatasetInterpretationActivityGoals | null;
  projectGoals: StartDatasetInterpretationProjectGoals | null;
}

interface PythonDatasetInterpretationResponse {
  externalJobId: string;
  status: "accepted" | "processing";
  acceptedAt: string;
}

export interface ConcernTaggingEntityInput {
  entityKey: string;
  text: string;
}

export interface ConcernTaggingInput {
  instruction: string;
  entities: ConcernTaggingEntityInput[];
  language: "de" | "en";
}

export interface ConcernTaggingResultOutput {
  entityKey: string;
  flagged: boolean;
  reason: string;
}

interface ConcernTaggingOutput {
  results: ConcernTaggingResultOutput[];
  llmUsage?: LlmUsageSummary | null;
}

export interface QualitativeCodingReviewRequestInput {
  uploadMetadataId: string;
  originalFileName: string;
  language: "de" | "en";
  privacySafePayload: Record<string, unknown>;
  sourceCodebookSelections?: Array<{
    targetFindingKey: string;
    sourceCodebookFrom: {
      uploadMetadataId: string;
      findingKey: string;
    };
    sourceCodebookCodes: Array<{
      code: string;
      label: string;
      description: string;
      exampleExcerpts: string[];
    }>;
    sourceCodebookOriginalFileName?: string | null;
  }>;
  datasetProfileTables: Array<{
    tableName: string;
    rowCount: number;
    columns: Array<{
      name: string;
      // Reuses contracts.ts's EpistemicRole rather than a hand-duplicated
      // union — see the comment on ActivityAnalysisV2ClarificationQuestionDraft's
      // questionCode below for why a hand-duplicated union here is a real risk,
      // not just a style nit.
      epistemicRole: EpistemicRole | null;
    }>;
  }>;
}

export interface QualitativeCodingReviewResponseOutput {
  findings: Array<{
    findingKey: string;
    tableName: string;
    textColumnName: string;
    syntheticCodeColumnName: string;
    rowCount: number;
    nonEmptyRowCount: number;
    sampleExcerpts: string[];
    existingCodeColumnNames: string[];
    proposedCodes: Array<{
      code: string;
      label: string;
      description: string;
      exampleExcerpts: string[];
    }>;
    proposedAssignments: Array<{
      rowIndex: number;
      assignedCode: string | null;
    }>;
    sourceCodebookFrom: {
      uploadMetadataId: string;
      findingKey: string;
    } | null;
    sourceCodebookOriginalFileName: string | null;
  }>;
  llmUsage?: LlmUsageSummary | null;
}

export interface ActivityAnalysisV2GoalInput {
  goalId: string;
  goalType: "output";
  goalText: string;
  targetNumber: number | null;
}

export interface ActivityAnalysisV2EvidenceColumnInput {
  name: string;
  role:
    | "identifier"
    | "primary_status"
    | "primary_date"
    | "measure"
    | "subgroup"
    | "free_text"
    | "other"
    | null;
  inferredType:
    | "identifier"
    | "numeric"
    | "date"
    | "categorical"
    | "free_text"
    | "boolean"
    | "unknown"
    | null;
  epistemicRole?: EpistemicRole | null;
  metricKind?: PreparedDatasetMetricKind | null;
  valueScope?: PreparedDatasetValueScope | null;
  // Grounds the planner's filter values in what the column actually
  // contains, instead of it inventing a value (e.g. emitting `equals true`
  // against a column that has never held a boolean, only literal strings
  // like "durchgeführt"). Populated in activityAnalysisV2Service.ts's
  // buildEvidenceTables (via resolveObservedValuesForColumn): a bounded
  // list of the column's most common actually-observed values for
  // categorical/boolean/unknown-typed columns, falling back to the
  // column's human-confirmed positiveStatusValues only when there are no
  // rows to observe from at all. Null when neither applies (numeric,
  // identifier, temporal, free-text columns, or a categorical column with
  // too many distinct values to usefully list).
  // The executor independently re-validates filter values against this
  // same set — see activityAnalysisV2ToolExecutor.ts's
  // getFilterValueGateRejectionMessage — so this field is grounding, not a
  // trust boundary by itself.
  observedValues?: string[] | null;
  subjectiveCodeProvenance?: {
    findingKey: string | null;
    sourceCodebookFrom: {
      uploadMetadataId: string;
      findingKey: string;
    } | null;
  } | null;
}

export interface ActivityAnalysisV2EvidenceTableInput {
  uploadMetadataId: string;
  originalFileName: string;
  evidenceModality: string | null;
  tableName: string;
  rowCount: number;
  identifierColumn: string | null;
  identifierHandling:
    | "assume_unique"
    | "allow_duplicate_rows_as_events"
    | "deduplicate_by_identifier"
    | "manual_review_required"
    | null;
  primaryStatusColumn: string | null;
  primaryDateColumn: string | null;
  columns: ActivityAnalysisV2EvidenceColumnInput[];
  plannerHints?: {
    dateCoverage: Array<{
      columnName: string;
      min: string;
      max: string;
      years: number[];
    }>;
    goalSupportColumns: Array<{
      name: string;
      goalType: "output" | null;
      inferredType:
        | "identifier"
        | "numeric"
        | "date"
        | "categorical"
        | "free_text"
        | "boolean"
        | "unknown"
        | null;
      epistemicRole?: EpistemicRole | null;
      metricKind?: PreparedDatasetMetricKind | null;
      valueScope?: PreparedDatasetValueScope | null;
    }>;
  };
}

export interface ActivityAnalysisV2PlanToolRequest {
  goalId: string;
  alias?: string | null;
  toolName:
    | "describe_evidence"
    | "excerpt_retrieval"
    | "create_cohort"
    | "filter_result"
    | "join_tables"
    | "anti_join"
    | "derive_numeric_column"
    | "compare_columns"
    | "profile_column"
    | "count_rows"
    | "count_distinct"
    | "count_distinct_keys"
    | "group_count"
    | "crosstab_count"
    | "group_aggregate"
    | "aggregate_numeric"
    | "intersection_count"
    | "intersection_set"
    | "union_count"
    | "union_set"
    | "difference_set"
    | "first_event"
    | "last_event"
    | "date_difference"
    | "event_gap"
    | "days_since_last_event"
    | "period_change"
    | "paired_change"
    | "paired_category_shift"
    | "time_bucket_count"
    | "calculate_ratio"
    | "calculate_difference"
    | "calculate_percent_change"
    | "calculate_sum"
    | "calculate_product"
    | "compare_target";
  arguments: Record<string, unknown>;
}

export interface ActivityAnalysisV2GoalPlan {
  goalId: string;
  goalType: "output";
  goalText: string;
  evaluationMode:
    "numeric_target" | "condition" | "directional_change" | "evidence_only";
  status: "planned" | "requires_clarification" | "requires_capability";
  rationale: string;
  plannedToolNames: ActivityAnalysisV2PlanToolRequest["toolName"][];
  missingCapabilities?: Array<{
    kind: "deterministic_calculation";
    name: string;
    reason: string;
  }>;
}

export interface ActivityAnalysisV2ClarificationAnswerInput {
  questionId: string;
  goalId: string | null;
  prompt: string;
  answeredValue: string;
  questionCode:
    | "normalization_merge"
    | "row_grain"
    | "duplicate_identifier_resolution"
    | "primary_status_field"
    | "positive_status_values"
    | "primary_date_field"
    | "filter_value_grounding"
    | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
}

export interface ActivityAnalysisV2ClarificationQuestionDraft {
  goalId?: string | null;
  // For the six closed questionCodes below, analyst.py no longer authors
  // this — clarificationQuestionCopy.ts renders userFacingPrompt from
  // questionCode + questionData instead (see
  // CLARIFICATION_QUESTION_WORDING_PLAN.md Phase 2). Defaults to "" via the
  // Zod schema below when the planner omits it. Still the real, LLM-authored
  // prompt text for the one documented exception: questionCode === null.
  prompt: string;
  // Reuses contracts.ts's InterpretationQuestionKind for the same reason
  // questionCode below does — see that comment.
  kind: InterpretationQuestionKind;
  questionDomain: "preparation" | "interpretation";
  options: string[] | null;
  recommendedOption: string | null;
  recommendedConfidence: number | null;
  isBlocking: boolean;
  // Reuses contracts.ts's InterpretationQuestionCode rather than a
  // hand-duplicated union — a hand-duplicated one here is exactly what let
  // epistemic_role_clarification/validated_scale_confirmation silently
  // fall out of sync with the Zod schema below.
  questionCode: InterpretationQuestionCode | null;
  targetTableName: string | null;
  targetColumnName: string | null;
  // Structured substitution data clarificationQuestionCopy.ts's renderer
  // needs for codes like positive_status_values/normalization_merge (see
  // CLARIFICATION_QUESTION_WORDING_PLAN.md).
  questionData?: Record<string, unknown> | null;
}

export interface ActivityAnalysisV2PlanValidation {
  status: "passed" | "failed";
  issues: string[];
}

interface ActivityAnalysisV2PlanRequest {
  activityId: string;
  activityName: string;
  language: "de" | "en";
  goals: ActivityAnalysisV2GoalInput[];
  evidenceTables: ActivityAnalysisV2EvidenceTableInput[];
  clarificationAnswers?: ActivityAnalysisV2ClarificationAnswerInput[];
  runLimits: {
    maxToolCalls: number;
    maxLlmIterations: number;
    timeoutMs: number;
    maxEvidenceItems: number;
  };
  // Wall-clock budget (ms) the planner's own internal grounding-retry loop
  // (up to runLimits.maxLlmIterations sequential OpenAI calls) should
  // self-regulate against. Always set strictly below
  // activityAnalysisV2PlanTimeoutMs so Python has a chance to notice it's
  // out of time and return a clean, deterministic failed/needs-clarification
  // response before this HTTP call's own AbortSignal fires — see the
  // PLANNING_TIME_BUDGET_SAFETY_MARGIN_MS comment where this is computed.
  planningTimeBudgetMs: number;
}

// A `categorical` evidence column the planner found no goal-linked tool
// request referencing — a candidate for the project-level context catalog
// (pure descriptive distributions, e.g. a district breakdown, with no goal
// or outcome meaning). Detected deterministically in Python, not by the
// LLM; carries no value/shares of its own — ia_backend computes the actual
// distribution. See IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §3.4.
export interface ActivityAnalysisV2PlanContextCandidate {
  tableName: string;
  columnName: string;
  uploadMetadataId: string;
}

// Run-time visibility into the deterministic context-candidate pass
// (analyst.py's _collect_context_candidates), so "why didn't column X
// become a chart candidate" is traceable instead of a silent zero — see
// activityAnalysisV2Diagnostics.ts's contextExtraction block, which merges
// these counts with the TS-side prepared-table-fallback signal.
export interface ActivityAnalysisV2PlanContextCandidateDiagnostics {
  totalCategoricalColumnsSeen: number;
  contextCandidatesProposed: number;
  contextCandidatesExcludedByReferencedStrings: number;
  contextCandidatesExcludedByDirectReference: number;
  contextCandidatesExcludedByUnresolvedScopeFallback: number;
}

export interface ActivityAnalysisV2PlanResponse {
  goalPlans: ActivityAnalysisV2GoalPlan[];
  toolRequests: ActivityAnalysisV2PlanToolRequest[];
  clarificationQuestions: ActivityAnalysisV2ClarificationQuestionDraft[];
  limitations: string[];
  validation: ActivityAnalysisV2PlanValidation;
  contextCandidates?: ActivityAnalysisV2PlanContextCandidate[];
  contextCandidateDiagnostics?: ActivityAnalysisV2PlanContextCandidateDiagnostics;
  llmUsage?: LlmUsageSummary | null;
}

// Mirrors ImpactCatalogEntry/OutcomeDistributionEntry/UnmeasuredOutcomeEntry
// in contracts.ts field-for-field, minus their "De"-suffixed field names —
// this request payload has no de/en split of its own, since the narrative
// call's `language` field already tells Python which language to write in,
// and these labels are plain display strings either way. See
// projectImpactStoryImpactCatalog.ts (the builder) and
// IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md §4.6.
export interface ProjectImpactStoryNarrativeCatalogPairedDeltaRequest {
  entryId: string;
  shape: "paired_delta";
  outcomeId: string;
  outcomeTerm: "short" | "long";
  outcomeStatement: string;
  pairLabel: string;
  beforeValue: number;
  afterValue: number;
  nMatched: number;
  nBaseline: number;
}

export interface ProjectImpactStoryNarrativeCatalogPairedCategoricalShiftRequest {
  entryId: string;
  shape: "paired_categorical_shift";
  outcomeId: string;
  outcomeTerm: "short" | "long";
  outcomeStatement: string;
  pairLabel: string;
  beforeShares: { label: string; count: number }[];
  afterShares: { label: string; count: number }[];
  nMatched: number;
  nBaseline: number;
}

export interface ProjectImpactStoryNarrativeCatalogSingleDistributionRequest {
  entryId: string;
  shape: "single_distribution";
  outcomeId: string;
  outcomeTerm: "short" | "long";
  outcomeStatement: string;
  questionLabel: string;
  shares: { label: string; count: number }[];
  n: number;
}

export interface ProjectImpactStoryNarrativeCatalogUnmeasuredRequest {
  entryId: string;
  shape: "unmeasured";
  outcomeId: string;
  outcomeTerm: "short" | "long";
  outcomeStatement: string;
}

export type ProjectImpactStoryNarrativeCatalogEntryRequest =
  | ProjectImpactStoryNarrativeCatalogPairedDeltaRequest
  | ProjectImpactStoryNarrativeCatalogPairedCategoricalShiftRequest
  | ProjectImpactStoryNarrativeCatalogSingleDistributionRequest
  | ProjectImpactStoryNarrativeCatalogUnmeasuredRequest;

// Deterministic, goal-linked activity/output facts built directly from the
// current grounded V2 runs, independent of the chart-plan LLM's
// headlineKpis selection. Each fact keeps the concrete calculation label/
// value plus the output goal it supports, so paragraph 1 can group by goal
// without ever needing a target-value field.
export interface ProjectImpactStoryNarrativeOutputFactRequest {
  entryId: string;
  goalId: string;
  goalText: string;
  label: string;
  value: number;
  formatAs: ImpactIndicatorTileFormat;
  narrativeReason: string;
}

export interface ProjectImpactStoryNarrativeRequest {
  projectId: string;
  projectName: string;
  language: "de" | "en";
  projectPeriod?: string | null;
  targetGroup?: string | null;
  region?: string | null;
  initialSituation?: string | null;
  outputFacts: ProjectImpactStoryNarrativeOutputFactRequest[];
  catalog: ProjectImpactStoryNarrativeCatalogEntryRequest[];
}

export interface ProjectImpactStoryNarrativeResponse {
  narrativeSummary: string;
  groundingStatus: "PASSED" | "FAILED";
  groundingRetryCount: number;
  fellBackToDeterministicSummary: boolean;
  llmUsage?: LlmUsageSummary | null;
}

// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §2 — deliberately just `text` and
// `language`, never a value/target/status alongside the text being
// shortened. See displayLabelService.ts for the caching layer this call
// sits behind. Generic across every caller (goal statements, chart
// bar/category labels, ...) — the model never sees anything but the bare
// string either way.
export interface DisplayLabelRequest {
  text: string;
  language: "de" | "en";
}

export interface DisplayLabelResponse {
  displayLabel: string;
  llmUsage?: LlmUsageSummary | null;
}

export interface ProjectImpactStoryChartPlanKpiCandidate {
  kpiId: string;
  label: string;
  entryIds: string[];
  aggregation: "single" | "sum" | "count" | "average";
  narrativeReason: string;
}

// See projectImpactStoryChartAuthoringRequestMapper.ts for how the catalog
// entries below get built, and ia_python_service's
// ProjectImpactStoryChartAuthoringRequest docstring for why this exists.
// Field names/shapes mirror the Python Pydantic models 1:1 by design.
// Deliberately has no "confirmed_paired_delta" variant: that shape is
// handled entirely
// by the deterministic projectImpactStoryConfirmedPairedDeltaCharts.ts
// instead, never sent into this LLM-driven catalog at all — see that
// file's own comment for why.
export type ProjectImpactStoryChartAuthoringCatalogEntryRequest =
  | {
      entryId: string;
      kind: "calculation";
      activityId: string;
      activityName: string;
      label: string;
      description: string | null;
      toolName: string | null;
      unit: string | null;
      value: number | null;
    }
  | {
      entryId: string;
      kind: "goal_assessment";
      activityId: string;
      activityName: string;
      label: string;
      description: string | null;
      goalType: "output" | null;
      assessmentStatus: string | null;
      achieved: boolean | null;
    }
  | {
      entryId: string;
      kind: "context_distribution";
      activityId: string;
      activityName: string;
      label: string;
      description: string | null;
      shares: { label: string; count: number }[];
      n: number;
    }
  | {
      entryId: string;
      kind: "paired_story_delta";
      activityId: string;
      activityName: string;
      label: string;
      description: string | null;
      beforeValue: number;
      afterValue: number;
      nMatched: number;
      nBaseline: number;
    }
  | {
      entryId: string;
      kind: "confirmed_paired_categorical_shift";
      outcomeId: string;
      outcomeTerm: "short" | "long";
      outcomeStatement: string;
      pairLabel: string;
      beforeShares: { label: string; count: number }[];
      afterShares: { label: string; count: number }[];
      nMatched: number;
      nBaseline: number;
    }
  | {
      entryId: string;
      kind: "confirmed_single_distribution";
      outcomeId: string;
      outcomeTerm: "short" | "long";
      outcomeStatement: string;
      questionLabel: string;
      shares: { label: string; count: number }[];
      n: number;
    };

export interface ProjectImpactStoryChartAuthoringRequest {
  projectId: string;
  projectName: string;
  language: "de" | "en";
  catalog: ProjectImpactStoryChartAuthoringCatalogEntryRequest[];
  allowedChartTypes: string[];
  headlineKpiCount: number;
}

export interface ProjectImpactStoryChartAuthoringComponentCandidate {
  entryId: string;
  shareFilter: string[] | null;
}

export interface ProjectImpactStoryChartAuthoringChartCandidate {
  chartId: string;
  chartType: string;
  title: string;
  subtitle: string | null;
  narrativeReason: string;
  components: ProjectImpactStoryChartAuthoringComponentCandidate[];
}

export interface ProjectImpactStoryChartAuthoringResponse {
  headlineKpis: ProjectImpactStoryChartPlanKpiCandidate[];
  chartPlan: ProjectImpactStoryChartAuthoringChartCandidate[];
  groundingStatus: "PASSED" | "FAILED";
  fellBackToDeterministicSelection: boolean;
  llmUsage?: LlmUsageSummary | null;
}

export interface OutcomeEvidencePairingSuggestionOutcomeStatementRequest {
  outcomeId: string;
  term: "short" | "long";
  statement: string;
}

export interface OutcomeEvidencePairingSuggestionCandidateRequest {
  candidateId: string;
  shape: "paired_delta" | "single_distribution";
  beforeLabel?: string | null;
  afterLabel?: string | null;
  categoryLabel?: string | null;
  activityLabel: string;
}

export interface OutcomeEvidencePairingSuggestionRequest {
  projectId: string;
  language: "de" | "en";
  outcomeStatements: OutcomeEvidencePairingSuggestionOutcomeStatementRequest[];
  candidates: OutcomeEvidencePairingSuggestionCandidateRequest[];
}

export interface OutcomeEvidencePairingSuggestionEntry {
  candidateId: string;
  outcomeId: string | null;
  rationale: string;
}

export interface OutcomeEvidencePairingSuggestionResponse {
  suggestions: OutcomeEvidencePairingSuggestionEntry[];
  groundingStatus: "PASSED" | "FAILED";
  llmUsage?: LlmUsageSummary | null;
}

// Replaces the suggestion request/response pair above for the merged
// "Ausgangslage & Wirkungsdaten" activity (OUTCOME_EVIDENCE_MERGE_PLAN.md
// §4.3): the model is given every eligible column on the activity (no
// pre-detected candidates) and proposes both the column pairing and the
// outcome match in one call.
export interface OutcomeEvidencePairingRecommendationCandidateRequest {
  columnId: string;
  label: string;
  epistemicRole?: string | null;
  inferredType?: string | null;
  distinctValueCount?: number | null;
  cohortTag?: string | null;
  // Human-set baseline/follow-up classification — see
  // OUTCOME_EVIDENCE_MERGE_PLAN.md's pre/post inversion fix. Python's
  // grounding check rejects a paired proposal unless both sides carry one
  // of these and they differ; ia_backend never trusts the LLM's own
  // beforeColumnId/afterColumnId placement for direction regardless.
  datasetRole?: "baseline" | "followup" | null;
}

export interface OutcomeEvidencePairingRecommendationRequest {
  projectId: string;
  language: "de" | "en";
  outcomeStatements: OutcomeEvidencePairingSuggestionOutcomeStatementRequest[];
  candidates: OutcomeEvidencePairingRecommendationCandidateRequest[];
}

export interface OutcomeEvidencePairingRecommendationEntry {
  shape: "paired_delta" | "paired_categorical_shift" | "single_distribution";
  beforeColumnId?: string | null;
  afterColumnId?: string | null;
  columnId?: string | null;
  outcomeId: string | null;
  rationale: string;
}

export interface OutcomeEvidencePairingRecommendationResponse {
  recommendations: OutcomeEvidencePairingRecommendationEntry[];
  groundingStatus: "PASSED" | "FAILED";
  llmUsage?: LlmUsageSummary | null;
}

// Runtime validation of the Python service's V2 plan response. TypeScript
// types alone are a compile-time hint about the *sender's* code, not a
// guarantee about what's actually on the wire — this is the boundary check
// CLAUDE.md requires for cross-service input. Deliberately loose on
// `arguments`/`llmUsage` internals: the deterministic tool executor already
// validates each tool's specific arguments at execution time and fails
// loudly per-tool, and `llmUsage` is cost/diagnostic metadata, not grounded
// analytical output. `toolName` is validated against the full enum here
// because the executor's dispatch has no catch-all for an unrecognized
// name — without this, a hallucinated tool name would silently produce
// zero calculations instead of a clear error.
const activityAnalysisV2ToolNameSchema = z.enum([
  "describe_evidence",
  "excerpt_retrieval",
  "create_cohort",
  "filter_result",
  "join_tables",
  "anti_join",
  "derive_numeric_column",
  "compare_columns",
  "profile_column",
  "count_rows",
  "count_distinct",
  "count_distinct_keys",
  "group_count",
  "crosstab_count",
  "group_aggregate",
  "aggregate_numeric",
  "intersection_count",
  "intersection_set",
  "union_count",
  "union_set",
  "difference_set",
  "first_event",
  "last_event",
  "date_difference",
  "event_gap",
  "days_since_last_event",
  "period_change",
  "paired_change",
  "paired_category_shift",
  "time_bucket_count",
  "calculate_ratio",
  "calculate_difference",
  "calculate_percent_change",
  "calculate_sum",
  "calculate_product",
  "compare_target",
]);

const activityAnalysisV2GoalPlanSchema = z.object({
  goalId: z.string(),
  goalType: z.literal("output"),
  goalText: z.string(),
  evaluationMode: z.enum([
    "numeric_target",
    "condition",
    "directional_change",
    "evidence_only",
  ]),
  status: z.enum(["planned", "requires_clarification", "requires_capability"]),
  rationale: z.string(),
  plannedToolNames: z.array(activityAnalysisV2ToolNameSchema),
  missingCapabilities: z
    .array(
      z.object({
        kind: z.literal("deterministic_calculation"),
        name: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
});

const activityAnalysisV2PlanToolRequestSchema = z.object({
  goalId: z.string(),
  alias: z.string().nullable().optional(),
  toolName: activityAnalysisV2ToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

const activityAnalysisV2ClarificationQuestionDraftSchema = z.object({
  goalId: z.string().nullable().optional(),
  // The Python planner intentionally leaves prompt null for closed
  // questionCode values because ia_backend renders userFacingPrompt from
  // questionCode + questionData instead. Normalize null to "" here so the
  // parsed TS type stays string-based for the one open-ended exception and
  // existing downstream code does not need to widen to string | null.
  prompt: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? ""),
  // Derived from interpretationQuestionKindValues for the same reason
  // questionCode is below — see that comment.
  kind: z.enum(interpretationQuestionKindValues),
  questionDomain: z.enum(["preparation", "interpretation"]),
  options: z.array(z.string()).nullable(),
  recommendedOption: z.string().nullable(),
  recommendedConfidence: z.number().nullable(),
  isBlocking: z.boolean(),
  // Derived from the same source of truth used everywhere else in the
  // backend (contracts.ts) rather than a hand-duplicated list, so this
  // can't silently drift out of sync with new question codes the way it
  // did for epistemic_role_clarification/validated_scale_confirmation —
  // those were added to the planner's InterpretationQuestionDraft schema
  // on the Python side and to contracts.ts here, but this Zod schema was
  // never updated, so a real plan response containing either code failed
  // this parse and the whole plan was rejected as malformed.
  questionCode: z.enum(interpretationQuestionCodeValues).nullable(),
  targetTableName: z.string().nullable(),
  targetColumnName: z.string().nullable(),
  questionData: z.record(z.unknown()).nullable().optional(),
});

const activityAnalysisV2PlanContextCandidateSchema = z.object({
  tableName: z.string(),
  columnName: z.string(),
  uploadMetadataId: z.string(),
});

const activityAnalysisV2PlanContextCandidateDiagnosticsSchema = z.object({
  totalCategoricalColumnsSeen: z.number(),
  contextCandidatesProposed: z.number(),
  contextCandidatesExcludedByReferencedStrings: z.number(),
  contextCandidatesExcludedByDirectReference: z.number(),
  contextCandidatesExcludedByUnresolvedScopeFallback: z.number(),
});

const activityAnalysisV2PlanResponseSchema = z.object({
  goalPlans: z.array(activityAnalysisV2GoalPlanSchema),
  toolRequests: z.array(activityAnalysisV2PlanToolRequestSchema),
  // Upstream should always send a list here (Python's response model uses a
  // default_factory list), but normalize null/missing to [] at the boundary
  // so "no clarification needed" is represented consistently even if an older
  // or drifting build serializes this field loosely.
  clarificationQuestions: z
    .array(activityAnalysisV2ClarificationQuestionDraftSchema)
    .nullish()
    .transform((value) => value ?? []),
  limitations: z.array(z.string()),
  validation: z.object({
    status: z.enum(["passed", "failed"]),
    issues: z.array(z.string()),
  }),
  contextCandidates: z
    .array(activityAnalysisV2PlanContextCandidateSchema)
    .optional(),
  contextCandidateDiagnostics:
    activityAnalysisV2PlanContextCandidateDiagnosticsSchema.optional(),
  llmUsage: z.unknown().nullable().optional(),
});

const projectImpactStoryNarrativeResponseSchema = z.object({
  narrativeSummary: z.string(),
  groundingStatus: z.enum(["PASSED", "FAILED"]),
  groundingRetryCount: z.number(),
  fellBackToDeterministicSummary: z.boolean(),
  llmUsage: z.unknown().nullable().optional(),
});

const displayLabelResponseSchema = z.object({
  displayLabel: z.string(),
  llmUsage: z.unknown().nullable().optional(),
});

// Deliberately no numeric `value` field anywhere in this schema — the
// chart-plan endpoint only ever selects entryIds and an aggregation kind,
// never a number. Backend re-validates every entryId against its own copy
// of the catalog and computes every displayed value itself; see
// projectImpactStoryChartPlanExecution.ts.
const projectImpactStoryChartPlanKpiCandidateSchema = z.object({
  kpiId: z.string(),
  label: z.string(),
  entryIds: z.array(z.string()),
  aggregation: z.enum(["single", "sum", "count", "average"]),
  narrativeReason: z.string(),
});

// Same "no numeric value field anywhere" invariant as the KPI schema
// above: shareFilter is strings copied from the catalog ia_backend itself
// sent, never a number the model could invent.
const projectImpactStoryChartAuthoringComponentCandidateSchema = z.object({
  entryId: z.string(),
  shareFilter: z.array(z.string()).nullable().optional(),
});

const projectImpactStoryChartAuthoringChartCandidateSchema = z.object({
  chartId: z.string(),
  chartType: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  narrativeReason: z.string(),
  components: z.array(projectImpactStoryChartAuthoringComponentCandidateSchema),
});

const projectImpactStoryChartAuthoringResponseSchema = z.object({
  headlineKpis: z.array(projectImpactStoryChartPlanKpiCandidateSchema),
  chartPlan: z.array(projectImpactStoryChartAuthoringChartCandidateSchema),
  groundingStatus: z.enum(["PASSED", "FAILED"]),
  fellBackToDeterministicSelection: z.boolean(),
  llmUsage: z.unknown().nullable().optional(),
});

// outcomeId is intentionally z.string() here, not validated against a
// closed list at this layer — the caller (outcomeEvidencePairingSuggestionService.ts)
// re-validates every outcomeId against the project's real
// ProjectOutcomeStatement ids, which is the real trust boundary. This
// schema only confirms the response is well-formed JSON of the right shape.
const outcomeEvidencePairingSuggestionEntrySchema = z.object({
  candidateId: z.string(),
  outcomeId: z.string().nullable(),
  rationale: z.string(),
});

const outcomeEvidencePairingSuggestionResponseSchema = z.object({
  suggestions: z.array(outcomeEvidencePairingSuggestionEntrySchema),
  groundingStatus: z.enum(["PASSED", "FAILED"]),
  llmUsage: z.unknown().nullable().optional(),
});

// columnId/outcomeId are intentionally z.string() here, not validated
// against a closed list at this layer — the caller
// (outcomeEvidenceRecommendationService.ts) re-validates every reference
// against the real candidate catalog and the project's real
// ProjectOutcomeStatement ids, which is the real trust boundary. This
// schema only confirms the response is well-formed JSON of the right shape.
const outcomeEvidencePairingRecommendationEntrySchema = z.object({
  shape: z.enum([
    "paired_delta",
    "paired_categorical_shift",
    "single_distribution",
  ]),
  beforeColumnId: z.string().nullable().optional(),
  afterColumnId: z.string().nullable().optional(),
  columnId: z.string().nullable().optional(),
  outcomeId: z.string().nullable(),
  rationale: z.string(),
});

// Validated in two passes rather than one z.array(entrySchema): Zod array
// validation is all-or-nothing, so a single recommendation carrying a
// `shape` value this backend version doesn't recognize yet (e.g. this
// service deployed before ia_python_service during a rollout of a new
// shape — see OUTCOME_EVIDENCE_MERGE_PLAN.md's deploy-order guidance) would
// otherwise fail the entire response and turn a mid-rollout gap into a
// hard 502 for every recommendation in that response, not just the
// unrecognized one. The envelope is still validated strictly — this only
// widens tolerance for individual recommendation shapes, not for a
// genuinely malformed response.
const outcomeEvidencePairingRecommendationResponseEnvelopeSchema = z.object({
  recommendations: z.array(z.unknown()),
  groundingStatus: z.enum(["PASSED", "FAILED"]),
  llmUsage: z.unknown().nullable().optional(),
});

interface QuantitativePreparedDatasetColumn {
  name: string;
  inferredType:
    | "identifier"
    | "numeric"
    | "date"
    | "categorical"
    | "free_text"
    | "boolean"
    | "unknown"
    | null;
  role:
    | "identifier"
    | "primary_status"
    | "primary_date"
    | "measure"
    | "subgroup"
    | "free_text"
    | "other";
  positiveStatusValues: string[];
  positiveStatusDefinitionText: string | null;
  normalizationAccepted: boolean | null;
  metricKind?: PreparedDatasetMetricKind | null;
  valueScope?: PreparedDatasetValueScope | null;
}

interface QuantitativePreparedDatasetTable {
  name: string;
  rowCount: number;
  columnCount: number;
  selectedRowGrain: string | null;
  identifierColumn: string | null;
  identifierHandling:
    | "assume_unique"
    | "allow_duplicate_rows_as_events"
    | "deduplicate_by_identifier"
    | "manual_review_required"
    | null;
  primaryStatusColumn: string | null;
  primaryDateColumn: string | null;
  columns: QuantitativePreparedDatasetColumn[];
  notes: string[];
}

interface QuantitativePreparedDatasetSnapshot {
  evidenceModality:
    | "structured_quantitative"
    | "structured_qualitative"
    | "mixed_dual_track"
    | "narrative_qualitative"
    | "insufficiently_extracted";
  isReadyForDeterministicAnalysis: boolean;
  unresolvedRequirements: string[];
  tables: QuantitativePreparedDatasetTable[];
}

interface DeterministicAnalysisMetric {
  metricKey: string;
  label: string;
  description: string;
  tableName: string;
  sourceColumns: string[];
  kind: "count" | "count_distinct" | "ratio" | "distribution" | "trend";
  formula: string;
  value: number | null;
  unit: string | null;
  components: Record<string, unknown>;
}

interface DeterministicAnalysisDistributionBucket {
  value: string | null;
  count: number;
  ratio: number | null;
}

interface DeterministicAnalysisDistribution {
  distributionKey: string;
  label: string;
  tableName: string;
  columnName: string;
  buckets: DeterministicAnalysisDistributionBucket[];
}

interface DeterministicAnalysisTrendPoint {
  period: string;
  rowCount: number;
  positiveCount: number | null;
  positiveRatio: number | null;
}

interface DeterministicAnalysisTrend {
  trendKey: string;
  label: string;
  tableName: string;
  dateColumnName: string;
  positiveStatusColumnName: string | null;
  points: DeterministicAnalysisTrendPoint[];
}

interface DeterministicAnalysisSubgroupSegment {
  value: string | null;
  rowCount: number;
  positiveCount: number | null;
  positiveRatio: number | null;
}

interface DeterministicAnalysisSubgroupBreakdown {
  breakdownKey: string;
  label: string;
  tableName: string;
  columnName: string;
  segments: DeterministicAnalysisSubgroupSegment[];
}

interface DeterministicAnalysisWarning {
  code: string;
  message: string;
}

interface DeterministicAnalysisCategoricalCrosstabCell {
  valueA: string | null;
  valueB: string | null;
  count: number;
  ratio: number | null;
}

interface DeterministicAnalysisCategoricalCrosstab {
  crosstabKey: string;
  label: string;
  tableName: string;
  columnAName: string;
  columnBName: string;
  cells: DeterministicAnalysisCategoricalCrosstabCell[];
}

interface DeterministicAnalysisNumericCategoryGroup {
  categoryValue: string | null;
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  q1: number | null;
  q3: number | null;
}

interface DeterministicAnalysisNumericCategorySummary {
  summaryKey: string;
  label: string;
  tableName: string;
  numericColumnName: string;
  categoryColumnName: string;
  groups: DeterministicAnalysisNumericCategoryGroup[];
}

interface DeterministicAnalysisNumericCorrelation {
  correlationKey: string;
  label: string;
  tableName: string;
  columnAName: string;
  columnBName: string;
  completePairCount: number;
  pearson: number | null;
  spearman: number | null;
}

interface DeterministicAnalysisCandidateIndicator {
  indicatorKey: string;
  label: string;
  description: string;
  tableName: string;
  formula: string;
  value: number | null;
  unit: string | null;
  sourceColumns: string[];
  groundingNote: string;
}

interface QuantitativeDeterministicAnalysis {
  status: "not_applicable" | "awaiting_preparation" | "ready";
  metrics: DeterministicAnalysisMetric[];
  distributions: DeterministicAnalysisDistribution[];
  trends: DeterministicAnalysisTrend[];
  subgroupBreakdowns: DeterministicAnalysisSubgroupBreakdown[];
  categoricalCrosstabs: DeterministicAnalysisCategoricalCrosstab[];
  numericCategorySummaries: DeterministicAnalysisNumericCategorySummary[];
  numericCorrelations: DeterministicAnalysisNumericCorrelation[];
  warnings: DeterministicAnalysisWarning[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
}

interface QuantitativeSynthesisIndicatorValueFilter {
  column: string;
  acceptedValues: string[];
}

interface QuantitativeSynthesisIndicatorSuggestedCalculation {
  operation:
    | "count"
    | "count_distinct"
    | "sum"
    | "mean"
    | "ratio"
    | "distribution"
    | "trend";
  column: string | null;
  groupByColumn: string | null;
  numerator: QuantitativeSynthesisIndicatorValueFilter | null;
  denominator: QuantitativeSynthesisIndicatorValueFilter | null;
  dateColumn: string | null;
  valueFilter: QuantitativeSynthesisIndicatorValueFilter | null;
}

interface QuantitativeSynthesisIndicatorComputedValue {
  sourceKind: "computed_from_table" | "extracted_from_text";
  value: number | null;
  unit: string | null;
  components: Record<string, unknown>;
  recordsIncluded: number;
  recordsExcluded: number;
  groundingStatus:
    "passed" | "failed_column_not_found" | "failed_number_not_in_text";
}

interface QuantitativeSynthesisIndicator {
  name: string;
  description: string;
  confidence: number;
  reason: string;
  relatedFields: string[];
  supportingParagraphKeys: string[];
  relevanceStage: "output" | "outcome" | "impact" | null;
  matchesStatedGoal: boolean;
  suggestedCalculation: QuantitativeSynthesisIndicatorSuggestedCalculation | null;
  computedValue: QuantitativeSynthesisIndicatorComputedValue | null;
}

interface QuantitativeSynthesisWarning {
  message: string;
  severity: "info" | "warning";
}

interface QuantitativeSynthesisGoalAlignment {
  goalSummary: string;
  isSupportedByData: boolean;
  relatedIndicatorNames: string[];
  gapExplanation: string | null;
}

interface QuantitativeInterpretationSynthesisInput {
  datasetProfile: Record<string, unknown> | null;
  preparedDataset: QuantitativePreparedDatasetSnapshot;
  deterministicAnalysis: QuantitativeDeterministicAnalysis;
  language: "de" | "en";
  activityGoals: StartDatasetInterpretationActivityGoals | null;
  projectGoals: StartDatasetInterpretationProjectGoals | null;
}

interface QuantitativeInterpretationSynthesisResponse {
  datasetType: string;
  overallConfidence: number;
  indicators: QuantitativeSynthesisIndicator[];
  warnings: QuantitativeSynthesisWarning[];
  goalAlignment: QuantitativeSynthesisGoalAlignment[];
  llmUsage?: LlmUsageSummary | null;
}

interface MixedSynthesisSupportingQuote {
  id: string;
  excerptText: string;
  excerptKind: "direct" | "paraphrased";
  speakerType:
    | "participant"
    | "caregiver"
    | "staff"
    | "volunteer"
    | "evaluator"
    | "unknown";
  stage: "output" | "outcome" | "impact" | "context" | "risk";
  confidence: number;
  reason: string;
  sourceReference: string;
  privacyMode: "verbatim_safe" | "redacted" | "paraphrased_only";
}

interface MixedSynthesisQualitativeFinding {
  id: string;
  summary: string;
  stage: "output" | "outcome" | "impact" | "context" | "risk";
  confidence: number;
  reason: string;
  supportingQuoteIds: string[];
  category:
    | "outcome_support"
    | "outcome_complication"
    | "outcome_contradiction"
    | "barrier"
    | "enabler"
    | "unintended_effect"
    | "context_only";
  outcomeReference: string | null;
  outcomeAnchorType:
    | "project_outcome"
    | "project_impact"
    | "activity_objective"
    | "activity_output"
    | "unanchored";
  relationToEvidence:
    "reinforces" | "contradicts" | "complicates" | "context_only";
}

interface MixedInterpretationSynthesisInput {
  datasetProfile: Record<string, unknown> | null;
  preparedDataset: QuantitativePreparedDatasetSnapshot;
  deterministicAnalysis: QuantitativeDeterministicAnalysis;
  qualitativeFindings: MixedSynthesisQualitativeFinding[];
  supportingQuotes: MixedSynthesisSupportingQuote[];
  language: "de" | "en";
  activityGoals: StartDatasetInterpretationActivityGoals | null;
  projectGoals: StartDatasetInterpretationProjectGoals | null;
}

export class PythonProcessingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
    private readonly timeoutMs: number,
    // The shared PYTHON_SERVICE_TIMEOUT_MS stays intentionally short for
    // lightweight Python-service calls. LLM-backed routes such as
    // AI-knowledge summary, interpretation synthesis, and concern tagging
    // need the longer, separately-configurable PYTHON_LLM_TIMEOUT_MS budget
    // instead; PYTHON_ANALYTICS_TIMEOUT_MS is still accepted as a legacy
    // alias for existing environments. A real activity summary was observed
    // timing out at ~60s despite the route itself eventually succeeding.
    private readonly llmTimeoutMs: number,
    private readonly logger?: Pick<FastifyBaseLogger, "warn">,
  ) {}

  // Qualitative coding review generation is the most LLM-call-heavy path in
  // this codebase — it can issue numFreeTextColumns * (1 +
  // ceil(rowCount/25)) sequential OpenAI calls before responding, well
  // beyond what the generic llmTimeoutMs (120s) budget assumes. This call
  // now runs inside a background processing job rather than a live HTTP
  // request (see ProcessingJobService/activityAnalysisWorker.ts), so a
  // generous ceiling here is no longer expensive: nothing holds a
  // user-facing connection open, heartbeat-based liveness is the real
  // "is this stuck" signal, and a timeout is retried automatically via the
  // job's attemptCount/maxAttempts instead of failing a user's request.
  private readonly qualitativeCodingReviewTimeoutMs = 480_000;

  // ActivityAnalystV2's planner is in the same position qualitative coding
  // review was in above: it now runs inside activityAnalysisWorker.ts's
  // background job, not a live user-facing request, so a longer ceiling
  // costs nothing — heartbeat-based lease renewal is the real liveness
  // signal, and a genuine hang is caught by the job's
  // attemptCount/maxAttempts retry rather than by this timeout. Kept as a
  // fixed ceiling rather than something that scales with evidence count,
  // since PHASE_1_RUN_LIMITS.maxEvidenceItems (activityAnalysisV2Service.ts)
  // already bounds the planner's worst-case input size to 40 items — a
  // generous fixed budget that comfortably covers that capped worst case is
  // simpler than modeling per-file cost. Smaller than
  // qualitativeCodingReviewTimeoutMs above because that one issues an
  // unbounded-by-evidence-count number of sequential LLM calls
  // (numFreeTextColumns * rows); the planner is at most two full calls
  // (the initial plan plus at most one auto-resolved-clarification replan,
  // see MAX_BACKEND_AUTO_CLARIFICATION_REPLANS).
  readonly activityAnalysisV2PlanTimeoutMs = 300_000;

  // Same reasoning as activityAnalysisV2PlanTimeoutMs above: both the
  // project-impact-story narrative and chart-plan calls run inside a
  // background "project_impact_story" job (see
  // activityAnalysisWorker.ts/projectImpactStoryController.ts — the
  // controller enqueues a job rather than calling buildProjectImpactStory
  // synchronously on the request, and the frontend polls for completion
  // rather than holding a live connection open), and each one runs its own
  // grounding-retry loop of up to 3 full LLM calls
  // (run_with_grounding_retries, _MAX_GROUNDING_RETRIES = 2 in both
  // narrative.py and chart_plan.py). The generic 120s llmTimeoutMs budget
  // was observed timing out a real narrative generation mid-retry-loop
  // despite the underlying work eventually succeeding — the same failure
  // mode noted for activityAnalysisV2PlanTimeoutMs above.
  readonly projectImpactStoryLlmTimeoutMs = 300_000;

  private authHeaders(): Record<string, string> {
    return { "x-internal-service-token": this.sharedSecret };
  }

  private buildRequestContext(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Record<string, unknown> {
    return {
      url: `${this.baseUrl}${path}`,
      path,
      method: init.method ?? "GET",
      timeoutMs,
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    unavailableMessage: string,
    unavailableCode: string,
    timeoutMessage: string,
    timeoutCode: string,
    timeoutMsOverride?: number,
  ): Promise<Response> {
    const timeoutMs = timeoutMsOverride ?? this.timeoutMs;
    const requestContext = this.buildRequestContext(path, init, timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        throw new AppError(unavailableMessage, 502, unavailableCode, {
          ...requestContext,
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          upstreamBody: responseBody.slice(0, 2000),
        });
      }

      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AppError(timeoutMessage, 504, timeoutCode, requestContext);
      }

      throw error;
    }
  }

  async getProcessingJobStatus(
    externalJobId: string,
  ): Promise<PythonProcessingJobStatusResponse> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/processing/jobs/${externalJobId}`,
        {
          headers: this.authHeaders(),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AppError(
          "The Python processing service timed out while returning the job status.",
          504,
          "python_processing_status_timeout",
        );
      }
      throw error;
    }

    if (response.status === 404) {
      throw new AppError(
        "The Python processing service no longer has this job.",
        404,
        "python_processing_job_not_found",
      );
    }

    if (!response.ok) {
      throw new AppError(
        "The Python processing service did not return a job status.",
        502,
        "python_processing_status_unavailable",
      );
    }

    return response.json() as Promise<PythonProcessingJobStatusResponse>;
  }

  async approvePrivacyReview(
    externalJobId: string,
    decisions: PrivacyReviewDecisions,
  ): Promise<ApprovePrivacyReviewResponse> {
    const response = await this.request(
      `/processing/jobs/${externalJobId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ decisions }),
      },
      "The Python processing service did not accept the privacy approval.",
      "python_processing_privacy_approval_unavailable",
      "The Python processing service timed out while approving the privacy review.",
      "python_processing_privacy_approval_timeout",
    );

    return response.json() as Promise<ApprovePrivacyReviewResponse>;
  }

  async proposeQualitativeCodingReview(
    input: QualitativeCodingReviewRequestInput,
  ): Promise<QualitativeCodingReviewResponseOutput> {
    const response = await this.request(
      "/internal/interpretation/qualitative-coding-review",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service did not return a qualitative coding review proposal.",
      "python_processing_qualitative_coding_review_unavailable",
      "The Python processing service timed out while generating the qualitative coding review proposal.",
      "python_processing_qualitative_coding_review_timeout",
      this.qualitativeCodingReviewTimeoutMs,
    );

    return response.json() as Promise<QualitativeCodingReviewResponseOutput>;
  }

  async startDatasetInterpretation(
    input: StartDatasetInterpretationInput,
  ): Promise<PythonDatasetInterpretationResponse> {
    const response = await this.request(
      "/processing/interpretation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          processingJobId: input.processingJobId,
          privacySafeRepresentationId: input.privacySafeRepresentationId,
          payload: input.payload,
          language: input.language,
          activityGoals: input.activityGoals,
          projectGoals: input.projectGoals,
        }),
      },
      "The Python processing service did not accept the interpretation job.",
      "python_processing_interpretation_unavailable",
      "The Python processing service timed out while accepting the interpretation job.",
      "python_processing_interpretation_timeout",
    );

    return response.json() as Promise<PythonDatasetInterpretationResponse>;
  }

  async synthesizeQuantitativeInterpretation(
    input: QuantitativeInterpretationSynthesisInput,
  ): Promise<QuantitativeInterpretationSynthesisResponse> {
    const response = await this.request(
      "/processing/interpretation/quantitative-synthesis",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          datasetProfile: input.datasetProfile,
          preparedDataset: input.preparedDataset,
          deterministicAnalysis: input.deterministicAnalysis,
          language: input.language,
          activityGoals: input.activityGoals,
          projectGoals: input.projectGoals,
        }),
      },
      "The Python processing service could not synthesize the quantitative interpretation.",
      "python_processing_quantitative_synthesis_unavailable",
      "The Python processing service timed out while synthesizing the quantitative interpretation.",
      "python_processing_quantitative_synthesis_timeout",
      this.llmTimeoutMs,
    );

    return response.json() as Promise<QuantitativeInterpretationSynthesisResponse>;
  }

  async synthesizeMixedInterpretation(
    input: MixedInterpretationSynthesisInput,
  ): Promise<QuantitativeInterpretationSynthesisResponse> {
    const attemptRequest = () =>
      this.request(
        "/processing/interpretation/mixed-synthesis",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            datasetProfile: input.datasetProfile,
            preparedDataset: input.preparedDataset,
            deterministicAnalysis: input.deterministicAnalysis,
            qualitativeFindings: input.qualitativeFindings,
            supportingQuotes: input.supportingQuotes,
            language: input.language,
            activityGoals: input.activityGoals,
            projectGoals: input.projectGoals,
          }),
        },
        "The Python processing service could not synthesize the mixed interpretation.",
        "python_processing_mixed_synthesis_unavailable",
        "The Python processing service timed out while synthesizing the mixed interpretation.",
        "python_processing_mixed_synthesis_timeout",
        this.llmTimeoutMs,
      );

    let response: Response;
    try {
      response = await attemptRequest();
    } catch (error) {
      // One retry, timeouts only: run_mixed_interpretation_synthesis on the
      // python side is a stateless request/response call with no side
      // effects, so retrying it is safe. A second failure (timeout or
      // otherwise) propagates to the caller as normal.
      if (
        error instanceof AppError &&
        error.code === "python_processing_mixed_synthesis_timeout"
      ) {
        response = await attemptRequest();
      } else {
        throw error;
      }
    }

    return response.json() as Promise<QuantitativeInterpretationSynthesisResponse>;
  }

  // An LLM classifying free text against an activity-authored instruction,
  // so it gets the extended timeout rather than the generic
  // lightweight-call budget.
  async runConcernTagging(
    input: ConcernTaggingInput,
  ): Promise<ConcernTaggingOutput> {
    const response = await this.request(
      "/internal/interpretation/concern-tagging",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not run concern tagging.",
      "python_processing_concern_tagging_unavailable",
      "The Python processing service timed out while running concern tagging.",
      "python_processing_concern_tagging_timeout",
      this.llmTimeoutMs,
    );

    return response.json() as Promise<ConcernTaggingOutput>;
  }

  async planActivityAnalysisV2(
    input: ActivityAnalysisV2PlanRequest,
  ): Promise<ActivityAnalysisV2PlanResponse> {
    const response = await this.request(
      "/internal/interpretation/activity-analysis-v2-plan",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not plan the ActivityAnalystV2 analysis.",
      "python_processing_activity_analysis_v2_plan_unavailable",
      "The Python processing service timed out while planning the ActivityAnalystV2 analysis.",
      "python_processing_activity_analysis_v2_plan_timeout",
      this.activityAnalysisV2PlanTimeoutMs,
    );

    const payload = await response.json();
    const parsed = activityAnalysisV2PlanResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed ActivityAnalystV2 plan.",
        502,
        "python_processing_activity_analysis_v2_plan_malformed",
        parsed.error.flatten(),
      );
    }

    return parsed.data as ActivityAnalysisV2PlanResponse;
  }

  async generateProjectImpactStoryNarrative(
    input: ProjectImpactStoryNarrativeRequest,
  ): Promise<ProjectImpactStoryNarrativeResponse> {
    const response = await this.request(
      "/internal/project-impact-story/narrative",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not generate the project impact story narrative.",
      "python_processing_project_impact_story_narrative_unavailable",
      "The Python processing service timed out while generating the project impact story narrative.",
      "python_processing_project_impact_story_narrative_timeout",
      this.projectImpactStoryLlmTimeoutMs,
    );

    const payload = await response.json();
    const parsed = projectImpactStoryNarrativeResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed project impact story narrative.",
        502,
        "python_processing_project_impact_story_narrative_malformed",
        parsed.error.flatten(),
      );
    }

    return parsed.data as ProjectImpactStoryNarrativeResponse;
  }

  async generateDisplayLabel(
    input: DisplayLabelRequest,
  ): Promise<DisplayLabelResponse> {
    const response = await this.request(
      "/internal/project-impact-story/display-label",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not generate a display label.",
      "python_processing_display_label_unavailable",
      "The Python processing service timed out while generating a display label.",
      "python_processing_display_label_timeout",
      this.llmTimeoutMs,
    );

    const payload = await response.json();
    const parsed = displayLabelResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed display label.",
        502,
        "python_processing_display_label_malformed",
        parsed.error.flatten(),
      );
    }

    return parsed.data as DisplayLabelResponse;
  }

  async planProjectImpactStoryChartAuthoring(
    input: ProjectImpactStoryChartAuthoringRequest,
  ): Promise<ProjectImpactStoryChartAuthoringResponse> {
    const response = await this.request(
      "/internal/project-impact-story/chart-authoring",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not author the project impact story chart layout.",
      "python_processing_project_impact_story_chart_authoring_unavailable",
      "The Python processing service timed out while authoring the project impact story chart layout.",
      "python_processing_project_impact_story_chart_authoring_timeout",
      this.projectImpactStoryLlmTimeoutMs,
    );

    const payload = await response.json();
    const parsed =
      projectImpactStoryChartAuthoringResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed project impact story chart authoring plan.",
        502,
        "python_processing_project_impact_story_chart_authoring_malformed",
        parsed.error.flatten(),
      );
    }

    return parsed.data as ProjectImpactStoryChartAuthoringResponse;
  }

  async suggestOutcomeEvidencePairingOutcomes(
    input: OutcomeEvidencePairingSuggestionRequest,
  ): Promise<OutcomeEvidencePairingSuggestionResponse> {
    const response = await this.request(
      "/internal/outcome-evidence-pairing/suggest-outcomes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not suggest outcome-evidence pairing outcomes.",
      "python_processing_outcome_evidence_pairing_suggestion_unavailable",
      "The Python processing service timed out while suggesting outcome-evidence pairing outcomes.",
      "python_processing_outcome_evidence_pairing_suggestion_timeout",
      this.llmTimeoutMs,
    );

    const payload = await response.json();
    const parsed =
      outcomeEvidencePairingSuggestionResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed outcome-evidence pairing suggestion.",
        502,
        "python_processing_outcome_evidence_pairing_suggestion_malformed",
        parsed.error.flatten(),
      );
    }

    return parsed.data as OutcomeEvidencePairingSuggestionResponse;
  }

  async recommendOutcomeEvidencePairings(
    input: OutcomeEvidencePairingRecommendationRequest,
  ): Promise<OutcomeEvidencePairingRecommendationResponse> {
    const response = await this.request(
      "/internal/outcome-evidence-pairing/recommend",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not recommend outcome-evidence pairings.",
      "python_processing_outcome_evidence_pairing_recommendation_unavailable",
      "The Python processing service timed out while recommending outcome-evidence pairings.",
      "python_processing_outcome_evidence_pairing_recommendation_timeout",
      this.llmTimeoutMs,
    );

    const payload = await response.json();
    const parsed =
      outcomeEvidencePairingRecommendationResponseEnvelopeSchema.safeParse(
        payload,
      );
    if (!parsed.success) {
      throw new AppError(
        "The Python processing service returned a malformed outcome-evidence pairing recommendation.",
        502,
        "python_processing_outcome_evidence_pairing_recommendation_malformed",
        parsed.error.flatten(),
      );
    }

    const recommendations: OutcomeEvidencePairingRecommendationEntry[] = [];
    parsed.data.recommendations.forEach((recommendation, index) => {
      const entry =
        outcomeEvidencePairingRecommendationEntrySchema.safeParse(
          recommendation,
        );
      if (entry.success) {
        recommendations.push(entry.data);
        return;
      }

      this.logger?.warn(
        {
          recommendationIndex: index,
          recommendation,
          validationErrors: entry.error.flatten(),
        },
        "dropping malformed outcome-evidence pairing recommendation entry from Python service response",
      );
    });

    return {
      ...parsed.data,
      recommendations,
    } as OutcomeEvidencePairingRecommendationResponse;
  }
}
