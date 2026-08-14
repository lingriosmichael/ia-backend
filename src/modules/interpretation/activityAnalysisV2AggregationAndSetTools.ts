// Aggregation and set-operation tool implementations: count_rows,
// count_distinct, profile_column, group_count, crosstab_count,
// group_aggregate, aggregate_numeric, intersection/union/difference
// (count + set), and time_bucket_count. Split out of
// activityAnalysisV2ToolExecutor.ts (see that file for the module-split
// rationale and dependency order).
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import {
  toCategoryValue,
  toNumericValue,
} from "./deterministicAnalysisService.js";
import type { ActivityAnalysisV2GroupAggregateMetric } from "./activityAnalysisV2ToolTypes.js";
import {
  buildCalculationId,
  buildCaseInsensitiveSetFromColumn,
  collectEpistemicRoles,
  countDistinctValues,
  mergeSourceColumnEpistemicRoles,
  toCaseInsensitiveMatchValue,
  toTimeBucketKey,
  type ActivityAnalysisV2ResolvedRowSource,
  type ActivityAnalysisV2RowAliasValue,
} from "./activityAnalysisV2ToolRowResolution.js";
import { createResultAliasValue } from "./activityAnalysisV2CoreRowTools.js";

export function executeCountRows(
  source: ActivityAnalysisV2ResolvedRowSource,
): ActivityAnalysisV2CalculationRecord[] {
  const calculationId = buildCalculationId("count_rows", {
    sourceLabel: source.sourceLabel,
    basis: source.basis,
    count: source.rows.length,
  });
  return [
    {
      calculationId,
      toolName: "count_rows",
      label: `Row count for ${source.sourceLabel}`,
      description:
        "Counts rows from a table selection or reusable deterministic result.",
      formula: `COUNT(${source.basis})`,
      value: source.rows.length,
      unit: "rows",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [],
      grain: source.grain,
      numerator: source.rows.length,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        count: source.rows.length,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function executeCountDistinct(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
): ActivityAnalysisV2CalculationRecord[] {
  const distinctCount = countDistinctValues(source.rows, columnName);
  const calculationId = buildCalculationId("count_distinct", {
    sourceLabel: source.sourceLabel,
    columnName,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "count_distinct",
      label: `Distinct count for ${columnName} in ${source.sourceLabel}`,
      description: "Counts distinct non-empty values in the requested column.",
      formula: `COUNT_DISTINCT(${columnName})`,
      value: distinctCount,
      unit: "distinct_values",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      grain: source.grain,
      numerator: distinctCount,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        distinctCount,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function executeProfileColumn(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
): ActivityAnalysisV2CalculationRecord[] {
  const values = source.rows.map((row) => row[columnName]);
  const nonNullCount = values.filter(
    (value) => toCategoryValue(value) !== null,
  ).length;
  const distinctCount = countDistinctValues(source.rows, columnName);
  const numericValues = values
    .map((value) => toNumericValue(value))
    .filter((value): value is number => value !== null);
  const calculationId = buildCalculationId("profile_column", {
    sourceLabel: source.sourceLabel,
    columnName,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "profile_column",
      label: `Profile for ${columnName} in ${source.sourceLabel}`,
      description:
        "Profiles completeness, cardinality, and numeric compatibility for one column.",
      formula: null,
      value: distinctCount,
      unit: "distinct_values",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      grain: source.grain,
      numerator: nonNullCount,
      denominator: source.rows.length,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        rowCount: source.rows.length,
        nonNullCount,
        distinctCount,
        numericValueCount: numericValues.length,
        numericMin:
          numericValues.length > 0 ? Math.min(...numericValues) : null,
        numericMax:
          numericValues.length > 0 ? Math.max(...numericValues) : null,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function executeGroupCount(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
): ActivityAnalysisV2CalculationRecord[] {
  const counts = new Map<string | null, number>();
  for (const row of source.rows) {
    const value = toCategoryValue(row[columnName]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const groups = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count);
  const calculationId = buildCalculationId("group_count", {
    sourceLabel: source.sourceLabel,
    columnName,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "group_count",
      label: `Group counts for ${columnName} in ${source.sourceLabel}`,
      description: "Counts records per category value in one column.",
      formula: `GROUP_COUNT(${columnName})`,
      value: groups.length,
      unit: "groups",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      grain: source.grain,
      numerator: source.rows.length,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        groups,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function executeCrosstabCount(
  source: ActivityAnalysisV2ResolvedRowSource,
  leftColumnName: string,
  rightColumnName: string,
): ActivityAnalysisV2CalculationRecord[] {
  const cells = new Map<
    string,
    { leftValue: string | null; rightValue: string | null; count: number }
  >();

  for (const row of source.rows) {
    const leftValue = toCategoryValue(row[leftColumnName]);
    const rightValue = toCategoryValue(row[rightColumnName]);
    const key = JSON.stringify([leftValue, rightValue]);
    const current = cells.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    cells.set(key, {
      leftValue,
      rightValue,
      count: 1,
    });
  }

  const cellRows = Array.from(cells.values()).sort(
    (left, right) => right.count - left.count,
  );
  const calculationId = buildCalculationId("crosstab_count", {
    sourceLabel: source.sourceLabel,
    leftColumnName,
    rightColumnName,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "crosstab_count",
      label: `Crosstab counts for ${leftColumnName} × ${rightColumnName} in ${source.sourceLabel}`,
      description:
        "Counts category combinations across two columns in one table.",
      formula: `CROSSTAB_COUNT(${leftColumnName}, ${rightColumnName})`,
      value: cellRows.length,
      unit: "cells",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [leftColumnName, rightColumnName],
      grain: source.grain,
      numerator: source.rows.length,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        cells: cellRows,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  }
  return sorted[midpoint] ?? null;
}

export function computeGroupAggregateMetric(
  rows: Record<string, unknown>[],
  metric: ActivityAnalysisV2GroupAggregateMetric,
): number | null {
  if (metric.operation === "count") {
    return rows.length;
  }
  if (metric.operation === "count_distinct") {
    if (!metric.columnName) {
      throw new Error(
        `Metric ${metric.alias} requires columnName for count_distinct.`,
      );
    }
    return countDistinctValues(rows, metric.columnName);
  }

  if (!metric.columnName) {
    throw new Error(
      `Metric ${metric.alias} requires columnName for ${metric.operation}.`,
    );
  }
  const numericValues = rows
    .map((row) => toNumericValue(row[metric.columnName!]))
    .filter((value): value is number => value !== null);
  if (metric.operation === "sum") {
    return numericValues.reduce((sum, current) => sum + current, 0);
  }
  if (metric.operation === "avg") {
    return numericValues.length > 0
      ? numericValues.reduce((sum, current) => sum + current, 0) /
          numericValues.length
      : null;
  }
  if (metric.operation === "min") {
    return numericValues.length > 0 ? Math.min(...numericValues) : null;
  }
  if (metric.operation === "max") {
    return numericValues.length > 0 ? Math.max(...numericValues) : null;
  }
  return calculateMedian(numericValues);
}

export function executeGroupAggregate(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  groupBy: string[],
  metrics: ActivityAnalysisV2GroupAggregateMetric[],
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const buckets = new Map<
    string,
    {
      groupValues: Record<string, string | null>;
      rows: Record<string, unknown>[];
    }
  >();

  for (const row of source.rows) {
    const groupValues = Object.fromEntries(
      groupBy.map((columnName) => [
        columnName,
        toCategoryValue(row[columnName]),
      ]),
    );
    const key = JSON.stringify(groupValues);
    const current = buckets.get(key);
    if (current) {
      current.rows.push(row);
      continue;
    }
    buckets.set(key, {
      groupValues,
      rows: [row],
    });
  }

  const groupedRows = Array.from(buckets.values()).map((bucket) => {
    const metricValues = Object.fromEntries(
      metrics.map((metric) => [
        metric.alias,
        computeGroupAggregateMetric(bucket.rows, metric),
      ]),
    );
    return {
      ...bucket.groupValues,
      ...metricValues,
    };
  });

  const calculationId = buildCalculationId("group_aggregate", {
    alias,
    sourceLabel: source.sourceLabel,
    groupBy,
    metrics,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: groupedRows,
    grain: "row",
    denominatorType: "rows",
    identifierColumn: null,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "group_aggregate",
        label: `Grouped result ${alias}`,
        description:
          "Builds a reusable grouped deterministic result table with aggregate metrics.",
        formula: null,
        value: groupedRows.length,
        unit: "groups",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [
          ...groupBy,
          ...metrics.flatMap((metric) =>
            metric.columnName ? [metric.columnName] : [],
          ),
        ],
        grain: "row",
        numerator: groupedRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          groupCount: groupedRows.length,
          groupBy,
          metrics,
          sourceLabel: source.sourceLabel,
          basis: source.basis,
          filters: source.filters,
          rows: groupedRows,
        },
      },
    ],
  };
}

export function executeAggregateNumeric(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
  operation: "sum" | "avg" | "min" | "max",
): ActivityAnalysisV2CalculationRecord[] {
  const values = source.rows
    .map((row) => toNumericValue(row[columnName]))
    .filter((value): value is number => value !== null);
  let value: number | null = null;
  if (values.length > 0) {
    if (operation === "sum") {
      value = values.reduce((sum, current) => sum + current, 0);
    } else if (operation === "avg") {
      value = values.reduce((sum, current) => sum + current, 0) / values.length;
    } else if (operation === "min") {
      value = Math.min(...values);
    } else if (operation === "max") {
      value = Math.max(...values);
    }
  }
  const calculationId = buildCalculationId("aggregate_numeric", {
    sourceLabel: source.sourceLabel,
    columnName,
    operation,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "aggregate_numeric",
      label: `${operation}(${columnName}) for ${source.sourceLabel}`,
      description: "Aggregates numeric values in one column.",
      formula: `${operation.toUpperCase()}(${columnName})`,
      value,
      unit: null,
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      grain: source.grain,
      numerator: value,
      denominator: values.length,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        operation,
        numericValueCount: values.length,
        value,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function buildRowMapFromColumn(
  rows: Record<string, unknown>[],
  columnName: string,
): {
  rowsByKey: Map<string, Record<string, unknown>>;
  duplicateKeyRowCount: number;
} {
  const rowsByKey = new Map<string, Record<string, unknown>>();
  let duplicateKeyRowCount = 0;
  for (const row of rows) {
    const value = toCaseInsensitiveMatchValue(row[columnName]);
    if (!value) {
      continue;
    }
    if (rowsByKey.has(value)) {
      // A cohort can only hold one representative row per member, so a
      // duplicate identifier's later rows are still dropped here — but
      // unlike before, the drop is now counted and surfaced in the
      // calculation result instead of disappearing silently.
      duplicateKeyRowCount += 1;
      continue;
    }
    rowsByKey.set(value, row);
  }
  return { rowsByKey, duplicateKeyRowCount };
}

export function executeSetCount(
  toolName: "intersection_count" | "union_count",
  leftSource: ActivityAnalysisV2ResolvedRowSource,
  rightSource: ActivityAnalysisV2ResolvedRowSource,
  leftColumnName: string,
  rightColumnName: string,
): ActivityAnalysisV2CalculationRecord[] {
  const leftSet = buildCaseInsensitiveSetFromColumn(
    leftSource.rows,
    leftColumnName,
  );
  const rightSet = buildCaseInsensitiveSetFromColumn(
    rightSource.rows,
    rightColumnName,
  );
  const overlap = Array.from(leftSet).filter((value) => rightSet.has(value));
  const count =
    toolName === "intersection_count"
      ? overlap.length
      : new Set([...leftSet, ...rightSet]).size;
  const calculationId = buildCalculationId(toolName, {
    leftSourceLabel: leftSource.sourceLabel,
    leftColumnName,
    rightSourceLabel: rightSource.sourceLabel,
    rightColumnName,
  });
  return [
    {
      calculationId,
      toolName,
      label:
        toolName === "intersection_count"
          ? `Intersection count between ${leftSource.sourceLabel} and ${rightSource.sourceLabel}`
          : `Union count between ${leftSource.sourceLabel} and ${rightSource.sourceLabel}`,
      description:
        toolName === "intersection_count"
          ? "Counts shared distinct member values across two deterministic sources."
          : "Counts distinct member values across the union of two deterministic sources.",
      formula:
        toolName === "intersection_count"
          ? `|DISTINCT(${leftColumnName}) ∩ DISTINCT(${rightColumnName})|`
          : `|DISTINCT(${leftColumnName}) ∪ DISTINCT(${rightColumnName})|`,
      value: count,
      unit: "distinct_entities",
      sourceUploadMetadataIds: [
        ...new Set([
          ...leftSource.sourceUploadMetadataIds,
          ...rightSource.sourceUploadMetadataIds,
        ]),
      ],
      sourceTableNames: [
        ...new Set([
          ...leftSource.sourceTableNames,
          ...rightSource.sourceTableNames,
        ]),
      ],
      sourceColumns: [leftColumnName, rightColumnName],
      grain: leftSource.grain,
      numerator: count,
      denominator: null,
      denominatorType: leftSource.denominatorType,
      identifierColumn:
        leftColumnName === rightColumnName ? leftColumnName : null,
      result: {
        count,
        leftDistinctCount: leftSet.size,
        rightDistinctCount: rightSet.size,
        sharedDistinctCount: overlap.length,
        leftSourceLabel: leftSource.sourceLabel,
        rightSourceLabel: rightSource.sourceLabel,
        leftFilters: leftSource.filters,
        rightFilters: rightSource.filters,
      },
    },
  ];
}

export function executeSetOperation(
  toolName: "intersection_set" | "union_set" | "difference_set",
  alias: string,
  leftSource: ActivityAnalysisV2ResolvedRowSource,
  rightSource: ActivityAnalysisV2ResolvedRowSource,
  leftColumnName: string,
  rightColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  cohort: ActivityAnalysisV2RowAliasValue;
} {
  const {
    rowsByKey: leftRowsByKey,
    duplicateKeyRowCount: leftDuplicateKeyRowCount,
  } = buildRowMapFromColumn(leftSource.rows, leftColumnName);
  const {
    rowsByKey: rightRowsByKey,
    duplicateKeyRowCount: rightDuplicateKeyRowCount,
  } = buildRowMapFromColumn(rightSource.rows, rightColumnName);
  const leftKeys = new Set(leftRowsByKey.keys());
  const rightKeys = new Set(rightRowsByKey.keys());
  const resultRows: Record<string, unknown>[] = [];

  if (toolName === "intersection_set") {
    for (const key of leftKeys) {
      if (rightKeys.has(key)) {
        resultRows.push(leftRowsByKey.get(key) ?? {});
      }
    }
  } else if (toolName === "difference_set") {
    for (const key of leftKeys) {
      if (!rightKeys.has(key)) {
        resultRows.push(leftRowsByKey.get(key) ?? {});
      }
    }
  } else {
    const unionKeys = new Set([...leftKeys, ...rightKeys]);
    for (const key of unionKeys) {
      resultRows.push(leftRowsByKey.get(key) ?? rightRowsByKey.get(key) ?? {});
    }
  }

  const sharedCount = Array.from(leftKeys).filter((key) =>
    rightKeys.has(key),
  ).length;
  const calculationId = buildCalculationId(toolName, {
    alias,
    leftSourceLabel: leftSource.sourceLabel,
    leftColumnName,
    rightSourceLabel: rightSource.sourceLabel,
    rightColumnName,
  });
  const mergedSourceColumnEpistemicRoles = mergeSourceColumnEpistemicRoles(
    leftSource.sourceColumnEpistemicRoles,
    rightSource.sourceColumnEpistemicRoles,
  );
  const cohort: ActivityAnalysisV2RowAliasValue = {
    alias,
    rows: resultRows,
    grain: leftSource.grain,
    denominatorType: leftSource.denominatorType,
    identifierColumn:
      leftColumnName === rightColumnName ? leftColumnName : null,
    sourceUploadMetadataIds: [
      ...new Set([
        ...leftSource.sourceUploadMetadataIds,
        ...rightSource.sourceUploadMetadataIds,
      ]),
    ],
    sourceTableNames: [
      ...new Set([
        ...leftSource.sourceTableNames,
        ...rightSource.sourceTableNames,
      ]),
    ],
    basis: "cohort",
    sourceColumnEpistemicRoles: mergedSourceColumnEpistemicRoles,
    epistemicRoles: collectEpistemicRoles(mergedSourceColumnEpistemicRoles),
  };
  return {
    cohort,
    calculations: [
      {
        calculationId,
        toolName,
        label: `Cohort ${alias}`,
        description:
          toolName === "intersection_set"
            ? "Creates a reusable cohort from the shared members of two deterministic sources."
            : toolName === "union_set"
              ? "Creates a reusable cohort from the union of two deterministic sources."
              : "Creates a reusable cohort from members present in the left source but not the right source.",
        formula:
          toolName === "intersection_set"
            ? `DISTINCT(${leftColumnName}) ∩ DISTINCT(${rightColumnName})`
            : toolName === "union_set"
              ? `DISTINCT(${leftColumnName}) ∪ DISTINCT(${rightColumnName})`
              : `DISTINCT(${leftColumnName}) \\ DISTINCT(${rightColumnName})`,
        value: resultRows.length,
        unit:
          leftSource.denominatorType === "distinct_entities"
            ? "distinct_entities"
            : "rows",
        sourceUploadMetadataIds: cohort.sourceUploadMetadataIds,
        sourceTableNames: cohort.sourceTableNames,
        sourceColumns: [leftColumnName, rightColumnName],
        grain: leftSource.grain,
        numerator: resultRows.length,
        denominator: null,
        denominatorType: leftSource.denominatorType,
        identifierColumn: cohort.identifierColumn,
        result: {
          cohortAlias: alias,
          count: resultRows.length,
          leftDistinctCount: leftKeys.size,
          rightDistinctCount: rightKeys.size,
          sharedDistinctCount: sharedCount,
          // A cohort holds one row per member, so an identifier repeated
          // within a single source can only contribute its first row; these
          // counts make that visible instead of a silent, unexplained drop.
          leftDuplicateKeyRowCount,
          rightDuplicateKeyRowCount,
          leftSourceLabel: leftSource.sourceLabel,
          rightSourceLabel: rightSource.sourceLabel,
          leftFilters: leftSource.filters,
          rightFilters: rightSource.filters,
          operation: toolName,
        },
      },
    ],
  };
}

export function executeTimeBucketCount(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
  granularity: "day" | "week" | "month" | "quarter" | "year",
): ActivityAnalysisV2CalculationRecord[] {
  const counts = new Map<string, number>();

  for (const row of source.rows) {
    const bucket = toTimeBucketKey(row[columnName], granularity);
    if (!bucket) {
      continue;
    }
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const buckets = Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));
  const calculationId = buildCalculationId("time_bucket_count", {
    sourceLabel: source.sourceLabel,
    columnName,
    granularity,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "time_bucket_count",
      label: `Time-bucket counts for ${columnName} in ${source.sourceLabel}`,
      description:
        "Counts records per time bucket derived from one date-compatible column.",
      formula: `TIME_BUCKET_COUNT(${columnName}, ${granularity})`,
      value: buckets.length,
      unit: "buckets",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      grain: source.grain,
      numerator: source.rows.length,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        buckets,
        granularity,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}
