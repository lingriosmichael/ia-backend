import { AppError } from "../../shared/errors/appError.js";
import type {
  LlmUsageSummary,
  PrivacyReviewDecisions,
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
  objectives: string | null;
  successIndicators: string | null;
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

interface AiKnowledgeSummaryInsightInput {
  text: string;
  isGoalRelevant: boolean;
  activityName?: string | null;
}

interface AiKnowledgeSummaryActivityGoalsInput {
  objectives: string | null;
  successIndicators: string | null;
}

interface AiKnowledgeSummaryProjectGoalsInput {
  projectGoal: string | null;
  impactModel: StartDatasetInterpretationProjectImpactModel | null;
  successIndicators: string | null;
}

interface GenerateAiKnowledgeSummaryInput {
  scope: "activity" | "project";
  subjectName: string;
  insights: AiKnowledgeSummaryInsightInput[];
  interpretedEvidenceCount: number;
  acknowledgedActivityCount?: number;
  language: "de" | "en";
  activityGoals?: AiKnowledgeSummaryActivityGoalsInput | null;
  projectGoals?: AiKnowledgeSummaryProjectGoalsInput | null;
}

interface GenerateAiKnowledgeSummaryResponse {
  summaryText: string;
  llmUsage?: LlmUsageSummary | null;
}

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
    | "activity_success_indicator"
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
  ) {}

  private authHeaders(): Record<string, string> {
    return { "x-internal-service-token": this.sharedSecret };
  }

  private async request(
    path: string,
    init: RequestInit,
    unavailableMessage: string,
    unavailableCode: string,
    timeoutMessage: string,
    timeoutCode: string,
  ): Promise<Response> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new AppError(unavailableMessage, 502, unavailableCode);
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
        throw new AppError(timeoutMessage, 504, timeoutCode);
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
    );

    return response.json() as Promise<QuantitativeInterpretationSynthesisResponse>;
  }

  async synthesizeMixedInterpretation(
    input: MixedInterpretationSynthesisInput,
  ): Promise<QuantitativeInterpretationSynthesisResponse> {
    const response = await this.request(
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
    );

    return response.json() as Promise<QuantitativeInterpretationSynthesisResponse>;
  }

  async generateAiKnowledgeSummary(
    input: GenerateAiKnowledgeSummaryInput,
  ): Promise<GenerateAiKnowledgeSummaryResponse> {
    const response = await this.request(
      "/internal/interpretation/ai-knowledge-summary",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(input),
      },
      "The Python processing service could not summarize the AI knowledge.",
      "python_processing_ai_knowledge_summary_unavailable",
      "The Python processing service timed out while summarizing the AI knowledge.",
      "python_processing_ai_knowledge_summary_timeout",
    );

    return response.json() as Promise<GenerateAiKnowledgeSummaryResponse>;
  }
}
