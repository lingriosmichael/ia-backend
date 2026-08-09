import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisRunV2RunLimits,
} from "../../shared/contracts.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import {
  readRowRecords,
  readTableRecords,
} from "./deterministicAnalysisService.js";
import type { InterpretationResultRepository } from "./interpretationResultRepository.js";
import type { CurrentActivityEvidenceSnapshot } from "./currentActivityEvidenceLoader.js";
import type {
  ActivityAnalysisV2TableContext,
  ActivityAnalysisV2ToolExecutionResult,
  ActivityAnalysisV2ToolRequest,
} from "./activityAnalysisV2ToolTypes.js";
import {
  buildToolCallId,
  requireScalarAliasValue,
  resolveSetSourceColumnName,
  resolveSourceRows,
  type ActivityAnalysisV2RowAliasValue,
} from "./activityAnalysisV2ToolRowResolution.js";
import {
  createCohortAliasValue,
  createResultAliasValue,
  executeAntiJoin,
  executeCountDistinctKeys,
  executeCreateCohort,
  executeDescribeEvidence,
  executeFilterResult,
  executeJoinTables,
} from "./activityAnalysisV2CoreRowTools.js";
import {
  executeCompareColumns,
  executeDeriveNumericColumn,
} from "./activityAnalysisV2RowMathTools.js";
import {
  executeBoundaryEvent,
  executeDateDifference,
  executeDaysSinceLastEvent,
  executeEventGap,
  executePairedChange,
  executePeriodChange,
} from "./activityAnalysisV2TemporalTools.js";
import {
  executeAggregateNumeric,
  executeCountDistinct,
  executeCountRows,
  executeCrosstabCount,
  executeGroupAggregate,
  executeGroupCount,
  executeProfileColumn,
  executeSetCount,
  executeSetOperation,
  executeTimeBucketCount,
} from "./activityAnalysisV2AggregationAndSetTools.js";
import {
  executeCalculateDifference,
  executeCalculatePercentChange,
  executeCalculateRatio,
  executeCalculateSumOrProduct,
  executeCompareTarget,
} from "./activityAnalysisV2ScalarMathTools.js";

// This is the orchestrator only: it resolves evidence into table contexts
// and dispatches each planned tool request to the appropriate execute*
// implementation. The tool implementations themselves live in the sibling
// activityAnalysisV2*Tools.ts modules (this file used to contain everything
// in one ~3,650-line file):
//   activityAnalysisV2ToolTypes.ts          - shared request/result types
//   activityAnalysisV2ToolRowResolution.ts  - row/alias resolution, filtering
//   activityAnalysisV2CoreRowTools.ts       - describe_evidence, cohorts,
//                                              filter_result, joins
//   activityAnalysisV2RowMathTools.ts       - derive_numeric_column,
//                                              compare_columns
//   activityAnalysisV2TemporalTools.ts      - event/date/period tools
//   activityAnalysisV2AggregationAndSetTools.ts - counts, grouping,
//                                              set operations
//   activityAnalysisV2ScalarMathTools.ts    - ratio/difference/target math
// Dependency order is one-directional (row resolution -> core row tools ->
// {row math, aggregation/set} -> temporal -> scalar math); none of the tool
// modules import back from this file.

export class ActivityAnalysisV2ToolExecutor {
  constructor(
    private readonly interpretationResultRepository: InterpretationResultRepository,
    private readonly datasetPreparationRepository: DatasetPreparationRepository,
  ) {}

  private async buildTableContexts(
    evidenceSnapshot: CurrentActivityEvidenceSnapshot,
  ): Promise<ActivityAnalysisV2TableContext[]> {
    const uploadIds = evidenceSnapshot.evidence.map(
      (item) => item.uploadMetadataId,
    );
    const results =
      await this.interpretationResultRepository.findLatestByUploadMetadataIds(
        uploadIds,
        databaseSession,
      );
    const resultByUploadMetadataId = new Map(
      results.map((result) => [result.uploadMetadataId, result]),
    );
    const preparations =
      await this.datasetPreparationRepository.findByInterpretationResultIds(
        results.map((result) => result.id),
        databaseSession,
      );
    const preparationByInterpretationResultId = new Map(
      preparations.map((preparation) => [
        preparation.interpretationResultId,
        preparation,
      ]),
    );

    const tables: ActivityAnalysisV2TableContext[] = [];
    for (const evidence of evidenceSnapshot.evidence) {
      const result =
        resultByUploadMetadataId.get(evidence.uploadMetadataId) ?? null;
      const preparation = result
        ? (preparationByInterpretationResultId.get(result.id) ?? null)
        : null;
      const preparedTablesByName = new Map(
        (preparation?.preparedDataset?.tables ?? []).map((table) => [
          table.name,
          table,
        ]),
      );
      for (const table of readTableRecords(evidence.payload)) {
        const tableName = typeof table.name === "string" ? table.name : "table";
        tables.push({
          uploadMetadataId: evidence.uploadMetadataId,
          privacySafeRepresentationId: evidence.privacySafeRepresentationId,
          tableName,
          rows: readRowRecords(table.rows),
          preparedTable: preparedTablesByName.get(tableName) ?? null,
        });
      }
    }
    return tables;
  }

  async execute(
    requests: ActivityAnalysisV2ToolRequest[],
    evidenceSnapshot: CurrentActivityEvidenceSnapshot,
    runLimits: ActivityAnalysisRunV2RunLimits,
    // Epoch ms marking the start of the *whole* run (planning + execution),
    // not just this method — callers that care about `runLimits.timeoutMs`
    // covering the full run should pass their own start time. Defaults to
    // "now" so existing callers/tests that only care about maxToolCalls are
    // unaffected.
    runStartedAt: number = Date.now(),
  ): Promise<ActivityAnalysisV2ToolExecutionResult> {
    if (requests.length > runLimits.maxToolCalls) {
      throw new Error(
        `Requested ${requests.length} tool calls, exceeding the configured limit of ${runLimits.maxToolCalls}.`,
      );
    }

    const tables = await this.buildTableContexts(evidenceSnapshot);
    const toolCallTrace: ActivityAnalysisV2ToolCallRecord[] = [];
    const calculations: ActivityAnalysisV2CalculationRecord[] = [];
    const scalarAliases = new Map<string, number | null>();
    const rowAliases = new Map<string, ActivityAnalysisV2RowAliasValue>();

    for (const [index, request] of requests.entries()) {
      if (Date.now() - runStartedAt > runLimits.timeoutMs) {
        throw new Error(
          `ActivityAnalystV2 run exceeded its configured time budget of ${runLimits.timeoutMs}ms during deterministic execution.`,
        );
      }
      const startedAt = new Date();
      let toolCalculations: ActivityAnalysisV2CalculationRecord[] = [];
      try {
        if (request.toolName === "describe_evidence") {
          toolCalculations = executeDescribeEvidence(tables);
        } else if (request.toolName === "create_cohort") {
          if (!request.alias) {
            throw new Error(
              "create_cohort requires an alias for the reusable cohort.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeCreateCohort(request.alias, source);
          rowAliases.set(
            request.alias,
            createCohortAliasValue(request.alias, source),
          );
        } else if (request.toolName === "filter_result") {
          if (!request.alias) {
            throw new Error(
              "filter_result requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeFilterResult(request.alias, source);
          rowAliases.set(
            request.alias,
            createResultAliasValue(request.alias, {
              ...source,
              basis: "result",
            }),
          );
        } else if (request.toolName === "join_tables") {
          if (!request.alias) {
            throw new Error(
              "join_tables requires an alias for the reusable result.",
            );
          }
          const leftSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.left,
          );
          const rightSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.right,
          );
          const joinResult = executeJoinTables(
            request.alias,
            leftSource,
            rightSource,
            request.arguments.keys,
            request.arguments.leftPrefix ?? "left",
            request.arguments.rightPrefix ?? "right",
          );
          toolCalculations = joinResult.calculations;
          rowAliases.set(request.alias, joinResult.resultAlias);
        } else if (request.toolName === "anti_join") {
          if (!request.alias) {
            throw new Error(
              "anti_join requires an alias for the reusable result.",
            );
          }
          const leftSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.left,
          );
          const rightSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.right,
          );
          const antiJoinResult = executeAntiJoin(
            request.alias,
            leftSource,
            rightSource,
            request.arguments.keys,
          );
          toolCalculations = antiJoinResult.calculations;
          rowAliases.set(request.alias, antiJoinResult.resultAlias);
        } else if (request.toolName === "derive_numeric_column") {
          if (!request.alias) {
            throw new Error(
              "derive_numeric_column requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const derivedResult = executeDeriveNumericColumn(
            request.alias,
            source,
            request.arguments.leftColumnName,
            request.arguments.rightColumnName,
            request.arguments.operation,
            request.arguments.outputColumnName,
          );
          toolCalculations = derivedResult.calculations;
          rowAliases.set(request.alias, derivedResult.resultAlias);
        } else if (request.toolName === "compare_columns") {
          if (!request.alias) {
            throw new Error(
              "compare_columns requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const comparedResult = executeCompareColumns(
            request.alias,
            source,
            request.arguments.leftColumnName,
            request.arguments.rightColumnName,
            request.arguments.comparison,
            request.arguments.outputColumnName,
          );
          toolCalculations = comparedResult.calculations;
          rowAliases.set(request.alias, comparedResult.resultAlias);
        } else if (request.toolName === "count_rows") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeCountRows(source);
        } else if (request.toolName === "count_distinct") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeCountDistinct(
            source,
            request.arguments.columnName,
          );
        } else if (request.toolName === "count_distinct_keys") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeCountDistinctKeys(
            source,
            request.arguments.columnNames,
          );
        } else if (request.toolName === "profile_column") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeProfileColumn(
            source,
            request.arguments.columnName,
          );
        } else if (request.toolName === "group_count") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeGroupCount(
            source,
            request.arguments.columnName,
          );
        } else if (request.toolName === "crosstab_count") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeCrosstabCount(
            source,
            request.arguments.leftColumnName,
            request.arguments.rightColumnName,
          );
        } else if (request.toolName === "group_aggregate") {
          if (!request.alias) {
            throw new Error(
              "group_aggregate requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const groupedResult = executeGroupAggregate(
            request.alias,
            source,
            request.arguments.groupBy,
            request.arguments.metrics,
          );
          toolCalculations = groupedResult.calculations;
          rowAliases.set(request.alias, groupedResult.resultAlias);
        } else if (request.toolName === "first_event") {
          if (!request.alias) {
            throw new Error(
              "first_event requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const firstEventResult = executeBoundaryEvent(
            "first_event",
            request.alias,
            source,
            request.arguments.entityColumnName,
            request.arguments.dateColumnName,
            request.arguments.outputDateColumnName,
          );
          toolCalculations = firstEventResult.calculations;
          rowAliases.set(request.alias, firstEventResult.resultAlias);
        } else if (request.toolName === "last_event") {
          if (!request.alias) {
            throw new Error(
              "last_event requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const lastEventResult = executeBoundaryEvent(
            "last_event",
            request.alias,
            source,
            request.arguments.entityColumnName,
            request.arguments.dateColumnName,
            request.arguments.outputDateColumnName,
          );
          toolCalculations = lastEventResult.calculations;
          rowAliases.set(request.alias, lastEventResult.resultAlias);
        } else if (request.toolName === "date_difference") {
          if (!request.alias) {
            throw new Error(
              "date_difference requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const dateDifferenceResult = executeDateDifference(
            request.alias,
            source,
            request.arguments.startDateColumnName,
            request.arguments.endDateColumnName,
            request.arguments.outputColumnName,
          );
          toolCalculations = dateDifferenceResult.calculations;
          rowAliases.set(request.alias, dateDifferenceResult.resultAlias);
        } else if (request.toolName === "event_gap") {
          if (!request.alias) {
            throw new Error(
              "event_gap requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const eventGapResult = executeEventGap(
            request.alias,
            source,
            request.arguments.entityColumnName,
            request.arguments.dateColumnName,
            request.arguments.outputColumnName,
          );
          toolCalculations = eventGapResult.calculations;
          rowAliases.set(request.alias, eventGapResult.resultAlias);
        } else if (request.toolName === "days_since_last_event") {
          if (!request.alias) {
            throw new Error(
              "days_since_last_event requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const recencyResult = executeDaysSinceLastEvent(
            request.alias,
            source,
            request.arguments.entityColumnName,
            request.arguments.dateColumnName,
            request.arguments.outputColumnName,
            request.arguments.outputDateColumnName,
            request.arguments.referenceDate,
            runStartedAt,
          );
          toolCalculations = recencyResult.calculations;
          rowAliases.set(request.alias, recencyResult.resultAlias);
        } else if (request.toolName === "period_change") {
          if (!request.alias) {
            throw new Error(
              "period_change requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const periodChangeResult = executePeriodChange(
            request.alias,
            source,
            request.arguments.dateColumnName,
            request.arguments.baselineStartDate,
            request.arguments.baselineEndDate,
            request.arguments.comparisonStartDate,
            request.arguments.comparisonEndDate,
          );
          toolCalculations = periodChangeResult.calculations;
          rowAliases.set(request.alias, periodChangeResult.resultAlias);
        } else if (request.toolName === "paired_change") {
          if (!request.alias) {
            throw new Error(
              "paired_change requires an alias for the reusable result.",
            );
          }
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          const pairedChangeResult = executePairedChange(
            request.alias,
            source,
            request.arguments.entityColumnName,
            request.arguments.preColumnName,
            request.arguments.postColumnName,
            request.arguments.outputColumnName,
          );
          toolCalculations = pairedChangeResult.calculations;
          rowAliases.set(request.alias, pairedChangeResult.resultAlias);
        } else if (request.toolName === "aggregate_numeric") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeAggregateNumeric(
            source,
            request.arguments.columnName,
            request.arguments.operation,
          );
        } else if (
          request.toolName === "intersection_count" ||
          request.toolName === "union_count"
        ) {
          const leftSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.left,
          );
          const rightSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.right,
          );
          toolCalculations = executeSetCount(
            request.toolName,
            leftSource,
            rightSource,
            resolveSetSourceColumnName(
              leftSource,
              request.arguments.left.columnName,
            ),
            resolveSetSourceColumnName(
              rightSource,
              request.arguments.right.columnName,
            ),
          );
        } else if (
          request.toolName === "intersection_set" ||
          request.toolName === "union_set" ||
          request.toolName === "difference_set"
        ) {
          if (!request.alias) {
            throw new Error(
              `${request.toolName} requires an alias for the reusable cohort.`,
            );
          }
          const leftSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.left,
          );
          const rightSource = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments.right,
          );
          const setResult = executeSetOperation(
            request.toolName,
            request.alias,
            leftSource,
            rightSource,
            resolveSetSourceColumnName(
              leftSource,
              request.arguments.left.columnName,
            ),
            resolveSetSourceColumnName(
              rightSource,
              request.arguments.right.columnName,
            ),
          );
          toolCalculations = setResult.calculations;
          rowAliases.set(request.alias, setResult.cohort);
        } else if (request.toolName === "time_bucket_count") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolCalculations = executeTimeBucketCount(
            source,
            request.arguments.columnName,
            request.arguments.granularity,
          );
        } else if (request.toolName === "calculate_ratio") {
          const numerator = requireScalarAliasValue(
            scalarAliases,
            request.arguments.numeratorAlias,
            "calculate_ratio",
          );
          const denominator = requireScalarAliasValue(
            scalarAliases,
            request.arguments.denominatorAlias,
            "calculate_ratio",
          );
          toolCalculations = executeCalculateRatio(
            numerator,
            denominator,
            request.arguments.label,
          );
        } else if (request.toolName === "calculate_difference") {
          const minuend = requireScalarAliasValue(
            scalarAliases,
            request.arguments.minuendAlias,
            "calculate_difference",
          );
          const subtrahend = requireScalarAliasValue(
            scalarAliases,
            request.arguments.subtrahendAlias,
            "calculate_difference",
          );
          toolCalculations = executeCalculateDifference(
            minuend,
            subtrahend,
            request.arguments.label,
          );
        } else if (request.toolName === "calculate_percent_change") {
          const baseline = requireScalarAliasValue(
            scalarAliases,
            request.arguments.baselineAlias,
            "calculate_percent_change",
          );
          const current = requireScalarAliasValue(
            scalarAliases,
            request.arguments.currentAlias,
            "calculate_percent_change",
          );
          toolCalculations = executeCalculatePercentChange(
            baseline,
            current,
            request.arguments.label,
          );
        } else if (
          request.toolName === "calculate_sum" ||
          request.toolName === "calculate_product"
        ) {
          const operands = request.arguments.operandAliases.map((alias) =>
            requireScalarAliasValue(scalarAliases, alias, request.toolName),
          );
          toolCalculations = executeCalculateSumOrProduct(
            request.toolName,
            operands,
            request.arguments.label,
          );
        } else if (request.toolName === "compare_target") {
          const value = requireScalarAliasValue(
            scalarAliases,
            request.arguments.valueAlias,
            "compare_target",
          );
          toolCalculations = executeCompareTarget(
            value,
            request.arguments.target,
            request.arguments.comparison,
            request.arguments.label,
          );
        }

        if (request.alias) {
          // Every tool branch above that produces a reusable row-based
          // result (a cohort, join result, derived table, etc.) already
          // calls rowAliases.set(request.alias, ...) itself. Checking that
          // directly — instead of maintaining a second, separately-updated
          // list of "which tool names are row-alias tools" — means a newly
          // added tool can never fall out of sync with this check: whether
          // it registers a row alias is derived from what it actually did,
          // not from a name someone has to remember to list here too.
          if (!rowAliases.has(request.alias)) {
            const primaryValue = toolCalculations[0]?.value;
            scalarAliases.set(
              request.alias,
              typeof primaryValue === "number" ? primaryValue : null,
            );
          }
        }

        calculations.push(...toolCalculations);
        const completedAt = new Date();
        toolCallTrace.push({
          toolCallId: buildToolCallId(
            request.toolName,
            index,
            request.arguments as Record<string, unknown>,
          ),
          toolName: request.toolName,
          arguments: request.arguments as Record<string, unknown>,
          calculationIds: toolCalculations.map(
            (calculation) => calculation.calculationId,
          ),
          status: "succeeded",
          errorMessage: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
        });
      } catch (error) {
        const completedAt = new Date();
        toolCallTrace.push({
          toolCallId: buildToolCallId(
            request.toolName,
            index,
            request.arguments as Record<string, unknown>,
          ),
          toolName: request.toolName,
          arguments: request.arguments as Record<string, unknown>,
          calculationIds: [],
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown tool failure.",
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
        });
        throw Object.assign(
          new Error(
            error instanceof Error ? error.message : "Unknown tool failure.",
          ),
          { toolCallTrace, calculations },
        );
      }
    }

    return { toolCallTrace, calculations };
  }
}
