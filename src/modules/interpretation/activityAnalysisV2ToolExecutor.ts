import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisRunV2RunLimits,
  EpistemicRole,
} from "../../shared/contracts.js";
import type { DatasetPreparationRepository } from "./datasetPreparationRepository.js";
import {
  extractSyntheticQualitativeCodeColumnMetadata,
  preparedDatasetTableWithSyntheticColumns,
} from "../processing/qualitativeCodingReviewSupport.js";
import {
  readRowRecords,
  readTableRecords,
  resolveObservedValuesForColumn,
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
  collectEpistemicRoles,
  mergeSourceColumnEpistemicRoles,
  normalizeComparableText,
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
import { executeExcerptRetrieval } from "./activityAnalysisV2QualitativeTools.js";
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
import { buildEpistemicRoleGateDowngradeMessage } from "./activityAnalysisV2EpistemicRoleGate.js";
import { buildFilterValueGateRejectionMessage } from "./activityAnalysisV2FilterValueGate.js";

const OUTCOME_CLAIM_BLOCKED_EPISTEMIC_ROLES = new Set<EpistemicRole>([
  "subjective_code",
  "free_text",
]);

function buildTableContextKey(
  uploadMetadataId: string,
  tableName: string,
): string {
  return `${uploadMetadataId}::${tableName}`;
}

type SourceColumnEpistemicRoleEntry = NonNullable<
  ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
>[number];

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
        const syntheticColumns =
          extractSyntheticQualitativeCodeColumnMetadata(table);
        tables.push({
          uploadMetadataId: evidence.uploadMetadataId,
          privacySafeRepresentationId: evidence.privacySafeRepresentationId,
          tableName,
          rows: readRowRecords(table.rows),
          preparedTable: preparedDatasetTableWithSyntheticColumns(
            preparedTablesByName.get(tableName) ?? null,
            syntheticColumns,
          ),
        });
      }
    }
    return tables;
  }

  private buildTableContextIndex(
    tables: ActivityAnalysisV2TableContext[],
  ): Map<string, ActivityAnalysisV2TableContext> {
    return new Map(
      tables.map((table) => [
        buildTableContextKey(table.uploadMetadataId, table.tableName),
        table,
      ]),
    );
  }

  // Delegates to the foundational module's collectEpistemicRoles — kept as
  // a private wrapper (rather than inlining `new Set(collectEpistemicRoles(...))`
  // at every call site) purely to keep the Set-wrapping in one place.
  private extractEpistemicRoles(
    roleEntries: SourceColumnEpistemicRoleEntry[],
  ): Set<EpistemicRole> {
    return new Set(collectEpistemicRoles(roleEntries));
  }

  private collectColumnEpistemicRolesFromReference(
    tables: ActivityAnalysisV2TableContext[],
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
    rowAliases: Map<string, ActivityAnalysisV2RowAliasValue>,
    reference: ActivityAnalysisV2ToolRequest["arguments"],
    columnNames: string[],
  ): SourceColumnEpistemicRoleEntry[] {
    const roleEntries: SourceColumnEpistemicRoleEntry[] = [];
    const seen = new Set<string>();
    let source;
    try {
      source = resolveSourceRows(
        tables,
        rowAliases,
        reference as ActivityAnalysisV2ToolRequest["arguments"] & {
          uploadMetadataId?: string;
          tableName?: string;
          cohortAlias?: string;
          resultAlias?: string;
        },
      );
    } catch {
      return roleEntries;
    }

    for (const uploadMetadataId of source.sourceUploadMetadataIds) {
      for (const tableName of source.sourceTableNames) {
        const table =
          tableContextIndex.get(
            buildTableContextKey(uploadMetadataId, tableName),
          ) ?? null;
        if (!table?.preparedTable) {
          continue;
        }
        for (const columnName of columnNames) {
          const column =
            table.preparedTable.columns.find(
              (candidate) => candidate.name === columnName,
            ) ?? null;
          if (!column) {
            continue;
          }
          const key = `${columnName}::${column.epistemicRole ?? "null"}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          roleEntries.push({
            columnName,
            epistemicRole: column.epistemicRole ?? null,
          });
        }
      }
    }

    if (
      (reference as { cohortAlias?: string; resultAlias?: string })
        .cohortAlias ||
      (reference as { cohortAlias?: string; resultAlias?: string }).resultAlias
    ) {
      const aliasName =
        (reference as { cohortAlias?: string; resultAlias?: string })
          .cohortAlias ??
        (reference as { cohortAlias?: string; resultAlias?: string })
          .resultAlias ??
        null;
      const aliasValue = aliasName ? (rowAliases.get(aliasName) ?? null) : null;
      if (aliasValue) {
        for (const columnName of columnNames) {
          const hasDirectMatch = roleEntries.some(
            (entry) => entry.columnName === columnName,
          );
          if (hasDirectMatch) {
            continue;
          }
          for (const role of aliasValue.epistemicRoles) {
            const key = `${columnName}::${role}`;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            roleEntries.push({
              columnName,
              epistemicRole: role,
            });
          }
        }
      }
    }

    return roleEntries;
  }

  private collectCalculationEpistemicRoles(
    calculations: ActivityAnalysisV2CalculationRecord[],
  ): Set<EpistemicRole> {
    return this.extractEpistemicRoles(
      calculations.flatMap(
        (calculation) => calculation.sourceColumnEpistemicRoles ?? [],
      ),
    );
  }

  private annotateCalculationSourceColumnRoles(
    calculations: ActivityAnalysisV2CalculationRecord[],
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
  ): ActivityAnalysisV2CalculationRecord[] {
    return calculations.map((calculation) => {
      const annotatedRoles: ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"] =
        [];
      const seen = new Set<string>();

      for (const uploadMetadataId of calculation.sourceUploadMetadataIds) {
        for (const tableName of calculation.sourceTableNames) {
          const table =
            tableContextIndex.get(
              buildTableContextKey(uploadMetadataId, tableName),
            ) ?? null;
          if (!table?.preparedTable) {
            continue;
          }
          const referencedColumnNames = [
            ...calculation.sourceColumns,
            ...(
              (calculation.result.filters as
                Array<{ columnName?: string }> | undefined) ?? []
            ).flatMap((filter) =>
              typeof filter.columnName === "string" ? [filter.columnName] : [],
            ),
            ...(
              (calculation.result.leftFilters as
                Array<{ columnName?: string }> | undefined) ?? []
            ).flatMap((filter) =>
              typeof filter.columnName === "string" ? [filter.columnName] : [],
            ),
            ...(
              (calculation.result.rightFilters as
                Array<{ columnName?: string }> | undefined) ?? []
            ).flatMap((filter) =>
              typeof filter.columnName === "string" ? [filter.columnName] : [],
            ),
          ];
          for (const columnName of referencedColumnNames) {
            const dedupeKey = `${columnName}`;
            if (seen.has(dedupeKey)) {
              continue;
            }
            seen.add(dedupeKey);
            const column =
              table.preparedTable.columns.find(
                (candidate) => candidate.name === columnName,
              ) ?? null;
            annotatedRoles.push({
              columnName,
              epistemicRole: column?.epistemicRole ?? null,
            });
          }
        }
      }

      return {
        ...calculation,
        sourceColumnEpistemicRoles: annotatedRoles,
      };
    });
  }

  private annotateQualitativeFindingSourceColumnRoles(
    findings: ActivityAnalysisV2ToolExecutionResult["qualitativeFindings"],
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
  ): ActivityAnalysisV2ToolExecutionResult["qualitativeFindings"] {
    return findings.map((finding) => {
      const annotatedRoles: NonNullable<
        ActivityAnalysisV2ToolExecutionResult["qualitativeFindings"][number]["sourceColumnEpistemicRoles"]
      > = [];
      const seen = new Set<string>();

      for (const uploadMetadataId of finding.sourceUploadMetadataIds) {
        for (const tableName of finding.sourceTableNames) {
          const table =
            tableContextIndex.get(
              buildTableContextKey(uploadMetadataId, tableName),
            ) ?? null;
          if (!table?.preparedTable) {
            continue;
          }
          for (const columnName of finding.sourceColumns) {
            const dedupeKey = `${columnName}`;
            if (seen.has(dedupeKey)) {
              continue;
            }
            seen.add(dedupeKey);
            const column =
              table.preparedTable.columns.find(
                (candidate) => candidate.name === columnName,
              ) ?? null;
            annotatedRoles.push({
              columnName,
              epistemicRole: column?.epistemicRole ?? null,
            });
          }
        }
      }

      return {
        ...finding,
        sourceColumnEpistemicRoles: annotatedRoles,
      };
    });
  }

  private collectRequestSourceColumnEpistemicRoles(
    request: ActivityAnalysisV2ToolRequest,
    tables: ActivityAnalysisV2TableContext[],
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
    rowAliases: Map<string, ActivityAnalysisV2RowAliasValue>,
    scalarAliasRoles: Map<string, Set<EpistemicRole>>,
  ): SourceColumnEpistemicRoleEntry[] {
    const collectFromReference = (
      reference: ActivityAnalysisV2ToolRequest["arguments"],
      columnNames: string[] = [],
    ): SourceColumnEpistemicRoleEntry[] => {
      try {
        const source = resolveSourceRows(
          tables,
          rowAliases,
          reference as ActivityAnalysisV2ToolRequest["arguments"] & {
            uploadMetadataId?: string;
            tableName?: string;
            cohortAlias?: string;
            resultAlias?: string;
          },
        );
        return mergeSourceColumnEpistemicRoles(
          source.sourceColumnEpistemicRoles,
          this.collectColumnEpistemicRolesFromReference(
            tables,
            tableContextIndex,
            rowAliases,
            reference,
            columnNames,
          ),
        );
      } catch {
        return [];
      }
    };

    if (request.toolName === "describe_evidence") {
      return [];
    }

    if (request.toolName === "compare_target") {
      return [
        ...(scalarAliasRoles.get(request.arguments.valueAlias) ?? []),
      ].map((role) => ({
        columnName: request.arguments.valueAlias,
        epistemicRole: role,
      }));
    }

    if (
      request.toolName === "calculate_ratio" ||
      request.toolName === "calculate_difference" ||
      request.toolName === "calculate_percent_change" ||
      request.toolName === "calculate_sum" ||
      request.toolName === "calculate_product"
    ) {
      const aliases =
        request.toolName === "calculate_ratio"
          ? [
              request.arguments.numeratorAlias,
              request.arguments.denominatorAlias,
            ]
          : request.toolName === "calculate_difference"
            ? [
                request.arguments.minuendAlias,
                request.arguments.subtrahendAlias,
              ]
            : request.toolName === "calculate_percent_change"
              ? [
                  request.arguments.baselineAlias,
                  request.arguments.currentAlias,
                ]
              : request.arguments.operandAliases;
      return mergeSourceColumnEpistemicRoles(
        aliases.flatMap((alias) =>
          [...(scalarAliasRoles.get(alias) ?? [])].map((role) => ({
            columnName: alias,
            epistemicRole: role,
          })),
        ),
      );
    }

    if (
      request.toolName === "intersection_count" ||
      request.toolName === "union_count" ||
      request.toolName === "intersection_set" ||
      request.toolName === "union_set" ||
      request.toolName === "difference_set"
    ) {
      return mergeSourceColumnEpistemicRoles(
        collectFromReference(
          request.arguments.left,
          request.arguments.left.columnName
            ? [request.arguments.left.columnName]
            : [],
        ),
        collectFromReference(
          request.arguments.right,
          request.arguments.right.columnName
            ? [request.arguments.right.columnName]
            : [],
        ),
      );
    }

    if (
      request.toolName === "join_tables" ||
      request.toolName === "anti_join"
    ) {
      return mergeSourceColumnEpistemicRoles(
        collectFromReference(
          request.arguments.left,
          request.arguments.keys.map((key) => key.leftColumnName),
        ),
        collectFromReference(
          request.arguments.right,
          request.arguments.keys.map((key) => key.rightColumnName),
        ),
      );
    }

    if (request.toolName === "group_aggregate") {
      return collectFromReference(request.arguments, [
        ...request.arguments.groupBy,
        ...request.arguments.metrics.flatMap((metric) =>
          metric.columnName ? [metric.columnName] : [],
        ),
      ]);
    }

    if (
      request.toolName === "create_cohort" ||
      request.toolName === "filter_result" ||
      request.toolName === "count_rows"
    ) {
      return collectFromReference(request.arguments);
    }

    if (
      request.toolName === "excerpt_retrieval" ||
      request.toolName === "count_distinct" ||
      request.toolName === "profile_column" ||
      request.toolName === "group_count" ||
      request.toolName === "aggregate_numeric" ||
      request.toolName === "time_bucket_count"
    ) {
      return collectFromReference(request.arguments, [
        request.arguments.columnName,
      ]);
    }

    if (request.toolName === "count_distinct_keys") {
      return collectFromReference(
        request.arguments,
        request.arguments.columnNames,
      );
    }

    if (request.toolName === "crosstab_count") {
      return collectFromReference(request.arguments, [
        request.arguments.leftColumnName,
        request.arguments.rightColumnName,
      ]);
    }

    if (
      request.toolName === "derive_numeric_column" ||
      request.toolName === "compare_columns"
    ) {
      return collectFromReference(request.arguments, [
        request.arguments.leftColumnName,
        request.arguments.rightColumnName,
        request.arguments.outputColumnName,
      ]);
    }

    if (
      request.toolName === "first_event" ||
      request.toolName === "last_event"
    ) {
      return collectFromReference(request.arguments, [
        request.arguments.entityColumnName,
        request.arguments.dateColumnName,
        request.arguments.outputDateColumnName,
      ]);
    }

    if (request.toolName === "date_difference") {
      return collectFromReference(request.arguments, [
        request.arguments.startDateColumnName,
        request.arguments.endDateColumnName,
        request.arguments.outputColumnName,
      ]);
    }

    if (request.toolName === "event_gap") {
      return collectFromReference(request.arguments, [
        request.arguments.entityColumnName,
        request.arguments.dateColumnName,
        request.arguments.outputColumnName,
      ]);
    }

    if (request.toolName === "days_since_last_event") {
      return collectFromReference(
        request.arguments,
        [
          request.arguments.entityColumnName,
          request.arguments.dateColumnName,
          request.arguments.outputColumnName,
          request.arguments.outputDateColumnName,
        ].filter((columnName): columnName is string => Boolean(columnName)),
      );
    }

    if (request.toolName === "period_change") {
      return collectFromReference(request.arguments, [
        request.arguments.dateColumnName,
      ]);
    }

    if (request.toolName === "paired_change") {
      return collectFromReference(request.arguments, [
        request.arguments.entityColumnName,
        request.arguments.preColumnName,
        request.arguments.postColumnName,
        request.arguments.outputColumnName,
      ]);
    }

    return [];
  }

  private getEpistemicRoleGateDowngradeMessage(
    request: ActivityAnalysisV2ToolRequest,
    tables: ActivityAnalysisV2TableContext[],
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
    rowAliases: Map<string, ActivityAnalysisV2RowAliasValue>,
    scalarAliasRoles: Map<string, Set<EpistemicRole>>,
  ): string | null {
    if (request.toolName === "aggregate_numeric") {
      const roles = this.extractEpistemicRoles(
        this.collectColumnEpistemicRolesFromReference(
          tables,
          tableContextIndex,
          rowAliases,
          request.arguments,
          [request.arguments.columnName],
        ),
      );
      const blockedRole = [...roles].find((role) =>
        OUTCOME_CLAIM_BLOCKED_EPISTEMIC_ROLES.has(role),
      );
      return blockedRole
        ? buildEpistemicRoleGateDowngradeMessage({
            toolName: request.toolName,
            role: blockedRole,
            columnName: request.arguments.columnName,
          })
        : null;
    }

    if (request.toolName === "group_aggregate") {
      for (const metric of request.arguments.metrics) {
        if (
          !metric.columnName ||
          !["sum", "avg", "min", "max", "median"].includes(metric.operation)
        ) {
          continue;
        }
        const roles = this.collectColumnEpistemicRolesFromReference(
          tables,
          tableContextIndex,
          rowAliases,
          request.arguments,
          [metric.columnName],
        );
        const blockedRole = [...this.extractEpistemicRoles(roles)].find(
          (role) => OUTCOME_CLAIM_BLOCKED_EPISTEMIC_ROLES.has(role),
        );
        if (blockedRole) {
          return buildEpistemicRoleGateDowngradeMessage({
            toolName: request.toolName,
            role: blockedRole,
            columnName: metric.columnName,
          });
        }
      }
    }

    if (request.toolName === "compare_target") {
      const roles =
        scalarAliasRoles.get(request.arguments.valueAlias) ?? new Set();
      const blockedRole = [...roles].find((role) =>
        OUTCOME_CLAIM_BLOCKED_EPISTEMIC_ROLES.has(role),
      );
      return blockedRole
        ? buildEpistemicRoleGateDowngradeMessage({
            toolName: request.toolName,
            role: blockedRole,
          })
        : null;
    }

    if (request.toolName === "paired_change") {
      // paired_change presents its result as a before/after outcome delta —
      // the same shape of claim as aggregate_numeric — so a subjective_code
      // column holding small integer codes must not be laundered into a
      // numeric "improvement" this way either.
      for (const columnName of [
        request.arguments.preColumnName,
        request.arguments.postColumnName,
      ]) {
        const roles = this.extractEpistemicRoles(
          this.collectColumnEpistemicRolesFromReference(
            tables,
            tableContextIndex,
            rowAliases,
            request.arguments,
            [columnName],
          ),
        );
        const blockedRole = [...roles].find((role) =>
          OUTCOME_CLAIM_BLOCKED_EPISTEMIC_ROLES.has(role),
        );
        if (blockedRole) {
          return buildEpistemicRoleGateDowngradeMessage({
            toolName: request.toolName,
            role: blockedRole,
            columnName,
          });
        }
      }
    }

    return null;
  }

  // Defense-in-depth against a planner-emitted filter value that was never
  // actually observed for the target column (e.g. `equals true` against a
  // status column that only ever holds literal strings like
  // "durchgeführt", or any other hallucinated/mismatched literal). Without
  // this, such a filter doesn't error — matchesFilter just evaluates every
  // row to false, so the tool call "succeeds" with a silently wrong
  // zero-row (or otherwise incorrect) result. See analyst.py's planning
  // instructions for the corresponding prompt-side guidance telling the
  // planner to ground filter values in observedValues in the first place;
  // this check is what actually enforces it regardless of whether the
  // planner followed that instruction.
  //
  // Scoped to the direct single-table case (arguments carrying
  // uploadMetadataId/tableName/filters directly, e.g. count_rows,
  // aggregate_numeric, group_count, filter_result sourced from a table) —
  // by far the most common shape, and the one the real production bug this
  // gate was added for actually took. Filters applied to a cohortAlias/
  // resultAlias or to a join's leftFilters/rightFilters are not covered by
  // this pass; a future extension can widen this the same way
  // collectColumnEpistemicRolesFromReference does for the epistemic-role
  // gate above, if it turns out to matter in practice.
  private getFilterValueGateRejectionMessage(
    request: ActivityAnalysisV2ToolRequest,
    tableContextIndex: Map<string, ActivityAnalysisV2TableContext>,
  ): string | null {
    const args = request.arguments as {
      uploadMetadataId?: string;
      tableName?: string;
      filters?: Array<{
        columnName?: string;
        operator?: string;
        value?: unknown;
      }>;
    };
    if (!args.uploadMetadataId || !args.tableName || !args.filters?.length) {
      return null;
    }
    const table = tableContextIndex.get(
      buildTableContextKey(args.uploadMetadataId, args.tableName),
    );
    if (!table?.preparedTable) {
      return null;
    }

    for (const filter of args.filters) {
      if (
        !filter.columnName ||
        (filter.operator !== "equals" &&
          filter.operator !== "not_equals" &&
          filter.operator !== "in" &&
          filter.operator !== "not_in")
      ) {
        continue;
      }
      const column = table.preparedTable.columns.find(
        (candidate) => candidate.name === filter.columnName,
      );
      if (!column) {
        continue;
      }
      const observedValues = resolveObservedValuesForColumn(column, table.rows);
      if (!observedValues) {
        continue;
      }
      const normalizedObserved = new Set(
        observedValues.map((value) => normalizeComparableText(value)),
      );

      const filterValues = Array.isArray(filter.value)
        ? filter.value
        : filter.value === undefined
          ? []
          : [filter.value];
      for (const value of filterValues) {
        if (typeof value !== "string") {
          // Booleans are always valid here: observedValues only exists for
          // categorical/boolean/unknown-typed columns, and a genuine flag
          // column's true/false is already normalized against its real
          // ja/nein-style values by matchesFilter's normalizeBooleanLikeText.
          continue;
        }
        if (!normalizedObserved.has(normalizeComparableText(value))) {
          return buildFilterValueGateRejectionMessage({
            toolName: request.toolName,
            columnName: filter.columnName,
            value,
          });
        }
      }
    }

    return null;
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
    const tableContextIndex = this.buildTableContextIndex(tables);
    const toolCallTrace: ActivityAnalysisV2ToolCallRecord[] = [];
    const calculations: ActivityAnalysisV2CalculationRecord[] = [];
    const qualitativeFindings: ActivityAnalysisV2ToolExecutionResult["qualitativeFindings"] =
      [];
    const scalarAliases = new Map<string, number | null>();
    const scalarAliasRoles = new Map<string, Set<EpistemicRole>>();
    const rowAliases = new Map<string, ActivityAnalysisV2RowAliasValue>();

    for (const [index, request] of requests.entries()) {
      if (Date.now() - runStartedAt > runLimits.timeoutMs) {
        throw new Error(
          `ActivityAnalystV2 run exceeded its configured time budget of ${runLimits.timeoutMs}ms during deterministic execution.`,
        );
      }
      const startedAt = new Date();

      // Only the specific request that would produce an outcome claim off a
      // blocked column is rejected — a goal downgraded by one blocked
      // compare_target/aggregate_numeric call must still be able to run its
      // other planned calls (e.g. excerpt_retrieval) so the
      // qualitative_evidence_only fallback it was downgraded to actually has
      // evidence. Do not short-circuit the rest of the goal's requests here.
      const downgradeMessage = this.getEpistemicRoleGateDowngradeMessage(
        request,
        tables,
        tableContextIndex,
        rowAliases,
        scalarAliasRoles,
      );
      const filterValueRejectionMessage = downgradeMessage
        ? null
        : this.getFilterValueGateRejectionMessage(request, tableContextIndex);
      const rejectionMessage = downgradeMessage ?? filterValueRejectionMessage;
      if (rejectionMessage) {
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
          qualitativeFindingIds: [],
          status: "failed",
          errorMessage: rejectionMessage,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
        });
        continue;
      }

      let toolCalculations: ActivityAnalysisV2CalculationRecord[] = [];
      let toolQualitativeFindings: ActivityAnalysisV2ToolExecutionResult["qualitativeFindings"] =
        [];
      try {
        if (request.toolName === "describe_evidence") {
          toolCalculations = executeDescribeEvidence(tables);
        } else if (request.toolName === "excerpt_retrieval") {
          const source = resolveSourceRows(
            tables,
            rowAliases,
            request.arguments,
          );
          toolQualitativeFindings = executeExcerptRetrieval(
            source,
            request.arguments.columnName,
            request.arguments.limit ?? 3,
          );
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

        toolCalculations = this.annotateCalculationSourceColumnRoles(
          toolCalculations,
          tableContextIndex,
        );
        toolQualitativeFindings =
          this.annotateQualitativeFindingSourceColumnRoles(
            toolQualitativeFindings,
            tableContextIndex,
          );

        const requestSourceColumnEpistemicRoles =
          this.collectRequestSourceColumnEpistemicRoles(
            request,
            tables,
            tableContextIndex,
            rowAliases,
            scalarAliasRoles,
          );
        toolCalculations = toolCalculations.map((calculation) => ({
          ...calculation,
          sourceColumnEpistemicRoles: mergeSourceColumnEpistemicRoles(
            calculation.sourceColumnEpistemicRoles ?? [],
            requestSourceColumnEpistemicRoles,
          ),
        }));
        toolQualitativeFindings = toolQualitativeFindings.map((finding) => ({
          ...finding,
          sourceColumnEpistemicRoles: mergeSourceColumnEpistemicRoles(
            finding.sourceColumnEpistemicRoles ?? [],
            requestSourceColumnEpistemicRoles,
          ),
        }));

        if (request.alias) {
          const requestEpistemicRoles = this.extractEpistemicRoles(
            requestSourceColumnEpistemicRoles,
          );
          const calculationEpistemicRoles =
            this.collectCalculationEpistemicRoles(toolCalculations);
          const combinedEpistemicRoles = new Set<EpistemicRole>([
            ...requestEpistemicRoles,
            ...calculationEpistemicRoles,
          ]);

          const existingRowAlias = rowAliases.get(request.alias) ?? null;
          if (existingRowAlias) {
            const mergedSourceColumnEpistemicRoles =
              mergeSourceColumnEpistemicRoles(
                existingRowAlias.sourceColumnEpistemicRoles,
                requestSourceColumnEpistemicRoles,
                toolCalculations.flatMap(
                  (calculation) => calculation.sourceColumnEpistemicRoles ?? [],
                ),
              );
            rowAliases.set(request.alias, {
              ...existingRowAlias,
              sourceColumnEpistemicRoles: mergedSourceColumnEpistemicRoles,
              epistemicRoles: [
                ...this.extractEpistemicRoles(mergedSourceColumnEpistemicRoles),
              ],
            });
          }
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
            scalarAliasRoles.set(request.alias, combinedEpistemicRoles);
          }
        }

        calculations.push(...toolCalculations);
        qualitativeFindings.push(...toolQualitativeFindings);
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
          qualitativeFindingIds: toolQualitativeFindings.map(
            (finding) => finding.findingId,
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
          qualitativeFindingIds: [],
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
          { toolCallTrace, calculations, qualitativeFindings },
        );
      }
    }

    return { toolCallTrace, calculations, qualitativeFindings };
  }
}
