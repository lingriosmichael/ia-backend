import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DeterministicAnalysisCandidateIndicator,
  DeterministicAnalysisCategoricalCrosstab,
  DeterministicAnalysisCategoricalCrosstabCell,
  DeterministicAnalysisDistribution,
  DeterministicAnalysisDistributionBucket,
  DeterministicAnalysisMetric,
  DeterministicAnalysisNumericCategoryGroup,
  DeterministicAnalysisNumericCategorySummary,
  DeterministicAnalysisNumericCorrelation,
  DeterministicAnalysisSubgroupBreakdown,
  DeterministicAnalysisSubgroupSegment,
  DeterministicAnalysisTrend,
  DeterministicAnalysisTrendPoint,
  DeterministicAnalysisWarning,
  PreparedDatasetColumn,
  PreparedDatasetSnapshot,
  PreparedDatasetTable,
} from "../../shared/contracts.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { DeterministicAnalysisRepository } from "./deterministicAnalysisRepository.js";
import type {
  DeterministicAnalysisPersistenceRecord,
  DeterministicAnalysisUpsertInput,
} from "./deterministicAnalysisPersistence.js";
import type { DatasetPreparationPersistenceRecord } from "./datasetPreparationPersistence.js";
import type { InterpretationResultPersistenceRecord } from "./interpretationResultPersistence.js";

const MAX_DISTRIBUTION_BUCKETS = 10;
const MAX_SUBGROUP_SEGMENTS = 8;
const MAX_CATEGORICAL_DISTINCT_VALUES = 8;
const MAX_CATEGORICAL_COLUMNS_FOR_RELATIONSHIPS = 6;
const MAX_CROSSTAB_PAIRS = 12;
const MAX_NUMERIC_CATEGORY_SUMMARIES = 16;
const MAX_NUMERIC_CORRELATIONS = 10;
const MIN_COMPLETE_CORRELATION_PAIRS = 3;

interface CategoricalColumnAnalysis {
  name: string;
  role: PreparedDatasetColumn["role"];
  valueCounts: Map<string | null, number>;
  sortedValues: Array<string | null>;
}

interface NumericColumnAnalysis {
  name: string;
  values: number[];
}

function readTableRecords(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(payload.tables)
    ? payload.tables.filter(
        (table): table is Record<string, unknown> =>
          Boolean(table) && typeof table === "object" && !Array.isArray(table),
      )
    : [];
}

function readRowRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toMonthKey(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function toCategoryValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeKeyFragment(value: string | null): string {
  if (value === null) {
    return "null";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "value";
}

function compareNullableStrings(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left.localeCompare(right);
}

function countPositiveRows(
  rows: Record<string, unknown>[],
  statusColumnName: string | null,
  positiveStatusValues: string[],
): number | null {
  if (!statusColumnName || positiveStatusValues.length === 0) {
    return null;
  }
  const accepted = new Set(positiveStatusValues.map(normalizeText));
  return rows.filter((row) => {
    const value = row[statusColumnName];
    return typeof value === "string" && accepted.has(normalizeText(value));
  }).length;
}

function countDistinctNonNull(
  rows: Record<string, unknown>[],
  columnName: string | null,
): number | null {
  if (!columnName) {
    return null;
  }
  const values = new Set(
    rows
      .map((row) => row[columnName])
      .filter(
        (value): value is string | number =>
          value !== null &&
          value !== undefined &&
          (typeof value === "string" || typeof value === "number"),
      ),
  );
  return values.size;
}

function roundNumber(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function computeQuantile(sortedValues: number[], quantile: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0] ?? null;
  }

  const index = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex] ?? null;
  const upperValue = sortedValues[upperIndex] ?? null;

  if (lowerValue === null || upperValue === null) {
    return null;
  }

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const weight = index - lowerIndex;
  return roundNumber(lowerValue + (upperValue - lowerValue) * weight);
}

function computeMean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return roundNumber(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
}

function computeStandardDeviation(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const mean = computeMean(values);
  if (mean === null) {
    return null;
  }

  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  return roundNumber(Math.sqrt(variance));
}

function computeNumericGroupSummary(
  values: number[],
): Omit<DeterministicAnalysisNumericCategoryGroup, "categoryValue" | "count"> {
  if (values.length === 0) {
    return {
      min: null,
      max: null,
      mean: null,
      median: null,
      standardDeviation: null,
      q1: null,
      q3: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean: computeMean(sorted),
    median: computeQuantile(sorted, 0.5),
    standardDeviation: computeStandardDeviation(sorted),
    q1: computeQuantile(sorted, 0.25),
    q3: computeQuantile(sorted, 0.75),
  };
}

function rankValues(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array(values.length).fill(0);

  let position = 0;
  while (position < sorted.length) {
    let end = position;
    while (
      end + 1 < sorted.length &&
      sorted[end + 1]?.value === sorted[position]?.value
    ) {
      end += 1;
    }

    const averageRank = (position + end + 2) / 2;
    for (let cursor = position; cursor <= end; cursor += 1) {
      const item = sorted[cursor];
      if (item) {
        ranks[item.index] = averageRank;
      }
    }

    position = end + 1;
  }

  return ranks;
}

function computePearson(valuesA: number[], valuesB: number[]): number | null {
  if (valuesA.length !== valuesB.length || valuesA.length < 2) {
    return null;
  }

  const meanA = computeMean(valuesA);
  const meanB = computeMean(valuesB);
  if (meanA === null || meanB === null) {
    return null;
  }

  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;

  for (let index = 0; index < valuesA.length; index += 1) {
    const centeredA = (valuesA[index] ?? 0) - meanA;
    const centeredB = (valuesB[index] ?? 0) - meanB;
    numerator += centeredA * centeredB;
    denominatorA += centeredA * centeredA;
    denominatorB += centeredB * centeredB;
  }

  if (denominatorA === 0 || denominatorB === 0) {
    return null;
  }

  return roundNumber(numerator / Math.sqrt(denominatorA * denominatorB));
}

function buildStatusDistribution(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
): DeterministicAnalysisDistribution | null {
  if (!table.primaryStatusColumn) {
    return null;
  }

  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const value = toCategoryValue(row[table.primaryStatusColumn]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const buckets: DeterministicAnalysisDistributionBucket[] = Array.from(
    counts.entries(),
  )
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return compareNullableStrings(left[0], right[0]);
    })
    .slice(0, MAX_DISTRIBUTION_BUCKETS)
    .map(([value, count]) => ({
      value,
      count,
      ratio: rows.length > 0 ? count / rows.length : null,
    }));

  return {
    distributionKey: `${table.name}::${table.primaryStatusColumn}::distribution`,
    label: `Distribution of ${table.primaryStatusColumn}`,
    tableName: table.name,
    columnName: table.primaryStatusColumn,
    buckets,
  };
}

function buildTrend(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  positiveStatusValues: string[],
): DeterministicAnalysisTrend | null {
  if (!table.primaryDateColumn) {
    return null;
  }

  const rowsByMonth = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const monthKey = toMonthKey(row[table.primaryDateColumn]);
    if (!monthKey) {
      continue;
    }
    const bucket = rowsByMonth.get(monthKey) ?? [];
    bucket.push(row);
    rowsByMonth.set(monthKey, bucket);
  }

  const points: DeterministicAnalysisTrendPoint[] = Array.from(
    rowsByMonth.entries(),
  )
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([period, monthRows]) => {
      const positiveCount = countPositiveRows(
        monthRows,
        table.primaryStatusColumn,
        positiveStatusValues,
      );
      return {
        period,
        rowCount: monthRows.length,
        positiveCount,
        positiveRatio:
          positiveCount !== null && monthRows.length > 0
            ? positiveCount / monthRows.length
            : null,
      };
    });

  if (points.length === 0) {
    return null;
  }

  return {
    trendKey: `${table.name}::${table.primaryDateColumn}::trend`,
    label: `Monthly trend for ${table.name}`,
    tableName: table.name,
    dateColumnName: table.primaryDateColumn,
    positiveStatusColumnName: table.primaryStatusColumn,
    points,
  };
}

function buildSubgroupBreakdowns(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  positiveStatusValues: string[],
): DeterministicAnalysisSubgroupBreakdown[] {
  return table.columns
    .filter((column) => column.role === "subgroup")
    .map((column) => {
      const segmentsByValue = new Map<string | null, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = toCategoryValue(row[column.name]);
        if (key === null) {
          continue;
        }
        const bucket = segmentsByValue.get(key) ?? [];
        bucket.push(row);
        segmentsByValue.set(key, bucket);
      }

      const segments: DeterministicAnalysisSubgroupSegment[] = Array.from(
        segmentsByValue.entries(),
      )
        .sort((left, right) => right[1].length - left[1].length)
        .slice(0, MAX_SUBGROUP_SEGMENTS)
        .map(([value, segmentRows]) => {
          const positiveCount = countPositiveRows(
            segmentRows,
            table.primaryStatusColumn,
            positiveStatusValues,
          );
          return {
            value,
            rowCount: segmentRows.length,
            positiveCount,
            positiveRatio:
              positiveCount !== null && segmentRows.length > 0
                ? positiveCount / segmentRows.length
                : null,
          };
        });

      return {
        breakdownKey: `${table.name}::${column.name}::subgroup`,
        label: `Breakdown by ${column.name}`,
        tableName: table.name,
        columnName: column.name,
        segments,
      };
    })
    .filter((breakdown) => breakdown.segments.length > 0);
}

function rolePriority(role: PreparedDatasetColumn["role"]): number {
  switch (role) {
    case "primary_status":
      return 0;
    case "subgroup":
      return 1;
    case "measure":
      return 4;
    case "other":
      return 2;
    case "free_text":
      return 5;
    case "identifier":
      return 6;
    case "primary_date":
      return 7;
    default:
      return 8;
  }
}

function buildCategoricalColumns(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
): CategoricalColumnAnalysis[] {
  return table.columns
    .filter((column) => {
      if (
        column.role === "identifier" ||
        column.role === "primary_date" ||
        column.role === "free_text"
      ) {
        return false;
      }

      return (
        column.inferredType === "categorical" ||
        column.inferredType === "boolean" ||
        column.inferredType === "unknown" ||
        column.role === "primary_status" ||
        column.role === "subgroup"
      );
    })
    .map((column) => {
      const valueCounts = new Map<string | null, number>();
      for (const row of rows) {
        const value = toCategoryValue(row[column.name]);
        valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
      }

      const uniqueCount = valueCounts.size;
      return {
        name: column.name,
        role: column.role,
        valueCounts,
        sortedValues: Array.from(valueCounts.entries())
          .sort((left, right) => {
            if (right[1] !== left[1]) {
              return right[1] - left[1];
            }
            return compareNullableStrings(left[0], right[0]);
          })
          .slice(0, MAX_DISTRIBUTION_BUCKETS)
          .map(([value]) => value),
        uniqueCount,
      };
    })
    .filter((column) => column.uniqueCount > 0)
    .sort((left, right) => {
      const roleDifference =
        rolePriority(left.role) - rolePriority(right.role);
      if (roleDifference !== 0) {
        return roleDifference;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, MAX_CATEGORICAL_COLUMNS_FOR_RELATIONSHIPS);
}

function buildCategoricalDistributions(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  categoricalColumns: CategoricalColumnAnalysis[],
): DeterministicAnalysisDistribution[] {
  return categoricalColumns
    .filter((column) => column.valueCounts.size <= MAX_CATEGORICAL_DISTINCT_VALUES)
    .map((column) => ({
      distributionKey: `${table.name}::${column.name}::distribution`,
      label: `Distribution of ${column.name}`,
      tableName: table.name,
      columnName: column.name,
      buckets: Array.from(column.valueCounts.entries())
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }
          return compareNullableStrings(left[0], right[0]);
        })
        .map(([value, count]) => ({
          value,
          count,
          ratio: rows.length > 0 ? count / rows.length : null,
        })),
    }));
}

function buildCategoricalValueMetricsAndCandidates(
  table: PreparedDatasetTable,
  rowCount: number,
  categoricalColumns: CategoricalColumnAnalysis[],
): {
  metrics: DeterministicAnalysisMetric[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
} {
  const metrics: DeterministicAnalysisMetric[] = [];
  const candidateIndicators: DeterministicAnalysisCandidateIndicator[] = [];

  for (const column of categoricalColumns) {
    if (column.valueCounts.size > MAX_CATEGORICAL_DISTINCT_VALUES) {
      continue;
    }

    for (const [value, count] of Array.from(column.valueCounts.entries()).sort(
      (left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return compareNullableStrings(left[0], right[0]);
      },
    )) {
      if (value === null) {
        continue;
      }

      const safeValue = sanitizeKeyFragment(value);
      const countMetric: DeterministicAnalysisMetric = {
        metricKey: `${table.name}::${column.name}::${safeValue}::count`,
        label: `${column.name} = ${value} count`,
        description: `Rows whose ${column.name} equals ${value}`,
        tableName: table.name,
        sourceColumns: [column.name],
        kind: "count",
        formula: `COUNT(${column.name} IN {${value}})`,
        value: count,
        unit: "count",
        components: {
          count,
          positiveStatusValues: [value],
          columnName: column.name,
          categoryValue: value,
        },
      };
      metrics.push(countMetric);
      candidateIndicators.push({
        indicatorKey: countMetric.metricKey,
        label: `${column.name}: ${value}`,
        description: countMetric.description,
        tableName: table.name,
        formula: countMetric.formula,
        value: countMetric.value,
        unit: countMetric.unit,
        sourceColumns: countMetric.sourceColumns,
        groundingNote:
          "Derived deterministically from one categorical value in the prepared dataset.",
      });

      const ratioMetric: DeterministicAnalysisMetric = {
        metricKey: `${table.name}::${column.name}::${safeValue}::ratio`,
        label: `${column.name} = ${value} ratio`,
        description: `Share of rows whose ${column.name} equals ${value}`,
        tableName: table.name,
        sourceColumns: [column.name],
        kind: "ratio",
        formula: `COUNT(${column.name} IN {${value}}) / COUNT(rows)`,
        value: rowCount > 0 ? count / rowCount : null,
        unit: "ratio",
        components: {
          numeratorCount: count,
          denominatorCount: rowCount,
          positiveStatusValues: [value],
          columnName: column.name,
          categoryValue: value,
        },
      };
      metrics.push(ratioMetric);
    }
  }

  return { metrics, candidateIndicators };
}

function buildCategoricalCrosstabs(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  categoricalColumns: CategoricalColumnAnalysis[],
): DeterministicAnalysisCategoricalCrosstab[] {
  const crosstabs: DeterministicAnalysisCategoricalCrosstab[] = [];

  for (let leftIndex = 0; leftIndex < categoricalColumns.length; leftIndex += 1) {
    const leftColumn = categoricalColumns[leftIndex];
    if (!leftColumn || leftColumn.valueCounts.size > MAX_CATEGORICAL_DISTINCT_VALUES) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < categoricalColumns.length;
      rightIndex += 1
    ) {
      const rightColumn = categoricalColumns[rightIndex];
      if (
        !rightColumn ||
        rightColumn.valueCounts.size > MAX_CATEGORICAL_DISTINCT_VALUES
      ) {
        continue;
      }

      if (crosstabs.length >= MAX_CROSSTAB_PAIRS) {
        return crosstabs;
      }

      const cellCounts = new Map<string, number>();
      for (const row of rows) {
        const valueA = toCategoryValue(row[leftColumn.name]);
        const valueB = toCategoryValue(row[rightColumn.name]);
        const key = `${valueA ?? "__NULL__"}::${valueB ?? "__NULL__"}`;
        cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      }

      const valuesA = Array.from(leftColumn.valueCounts.keys()).sort(
        compareNullableStrings,
      );
      const valuesB = Array.from(rightColumn.valueCounts.keys()).sort(
        compareNullableStrings,
      );

      const cells: DeterministicAnalysisCategoricalCrosstabCell[] = [];
      for (const valueA of valuesA) {
        for (const valueB of valuesB) {
          const key = `${valueA ?? "__NULL__"}::${valueB ?? "__NULL__"}`;
          const count = cellCounts.get(key) ?? 0;
          cells.push({
            valueA,
            valueB,
            count,
            ratio: rows.length > 0 ? count / rows.length : null,
          });
        }
      }

      crosstabs.push({
        crosstabKey: `${table.name}::${leftColumn.name}::${rightColumn.name}::crosstab`,
        label: `${leftColumn.name} by ${rightColumn.name}`,
        tableName: table.name,
        columnAName: leftColumn.name,
        columnBName: rightColumn.name,
        cells,
      });
    }
  }

  return crosstabs;
}

function buildNumericColumns(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
): NumericColumnAnalysis[] {
  return table.columns
    .filter(
      (column) =>
        column.inferredType === "numeric" || column.role === "measure",
    )
    .map((column) => ({
      name: column.name,
      values: rows
        .map((row) => toNumericValue(row[column.name]))
        .filter((value): value is number => value !== null),
    }))
    .filter((column) => column.values.length > 0);
}

function buildNumericCategorySummaries(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  numericColumns: NumericColumnAnalysis[],
  categoricalColumns: CategoricalColumnAnalysis[],
): DeterministicAnalysisNumericCategorySummary[] {
  const summaries: DeterministicAnalysisNumericCategorySummary[] = [];

  for (const numericColumn of numericColumns) {
    for (const categoricalColumn of categoricalColumns) {
      if (summaries.length >= MAX_NUMERIC_CATEGORY_SUMMARIES) {
        return summaries;
      }

      if (
        categoricalColumn.valueCounts.size > MAX_CATEGORICAL_DISTINCT_VALUES ||
        categoricalColumn.name === numericColumn.name
      ) {
        continue;
      }

      const valuesByCategory = new Map<string | null, number[]>();
      for (const row of rows) {
        const numericValue = toNumericValue(row[numericColumn.name]);
        if (numericValue === null) {
          continue;
        }
        const categoryValue = toCategoryValue(row[categoricalColumn.name]);
        const bucket = valuesByCategory.get(categoryValue) ?? [];
        bucket.push(numericValue);
        valuesByCategory.set(categoryValue, bucket);
      }

      const groups: DeterministicAnalysisNumericCategoryGroup[] = Array.from(
        valuesByCategory.entries(),
      )
        .sort((left, right) => {
          if (right[1].length !== left[1].length) {
            return right[1].length - left[1].length;
          }
          return compareNullableStrings(left[0], right[0]);
        })
        .map(([categoryValue, values]) => ({
          categoryValue,
          count: values.length,
          ...computeNumericGroupSummary(values),
        }));

      if (groups.length < 2) {
        continue;
      }

      summaries.push({
        summaryKey: `${table.name}::${numericColumn.name}::by::${categoricalColumn.name}`,
        label: `${numericColumn.name} by ${categoricalColumn.name}`,
        tableName: table.name,
        numericColumnName: numericColumn.name,
        categoryColumnName: categoricalColumn.name,
        groups,
      });
    }
  }

  return summaries;
}

function buildNumericCorrelations(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  numericColumns: NumericColumnAnalysis[],
): DeterministicAnalysisNumericCorrelation[] {
  const correlations: DeterministicAnalysisNumericCorrelation[] = [];

  for (let leftIndex = 0; leftIndex < numericColumns.length; leftIndex += 1) {
    const leftColumn = numericColumns[leftIndex];
    if (!leftColumn) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < numericColumns.length;
      rightIndex += 1
    ) {
      const rightColumn = numericColumns[rightIndex];
      if (!rightColumn) {
        continue;
      }

      if (correlations.length >= MAX_NUMERIC_CORRELATIONS) {
        return correlations;
      }

      const pairs = rows
        .map((row) => ({
          left: toNumericValue(row[leftColumn.name]),
          right: toNumericValue(row[rightColumn.name]),
        }))
        .filter(
          (
            pair,
          ): pair is {
            left: number;
            right: number;
          } => pair.left !== null && pair.right !== null,
        );

      if (pairs.length < MIN_COMPLETE_CORRELATION_PAIRS) {
        continue;
      }

      const leftValues = pairs.map((pair) => pair.left);
      const rightValues = pairs.map((pair) => pair.right);

      correlations.push({
        correlationKey: `${table.name}::${leftColumn.name}::${rightColumn.name}::correlation`,
        label: `${leftColumn.name} vs ${rightColumn.name}`,
        tableName: table.name,
        columnAName: leftColumn.name,
        columnBName: rightColumn.name,
        completePairCount: pairs.length,
        pearson: computePearson(leftValues, rightValues),
        spearman: computePearson(rankValues(leftValues), rankValues(rightValues)),
      });
    }
  }

  return correlations;
}

function buildPrimaryStatusMetricsAndCandidates(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  positiveStatusValues: string[],
): {
  metrics: DeterministicAnalysisMetric[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
} {
  const metrics: DeterministicAnalysisMetric[] = [];
  const candidateIndicators: DeterministicAnalysisCandidateIndicator[] = [];

  const positiveCount = countPositiveRows(
    rows,
    table.primaryStatusColumn,
    positiveStatusValues,
  );
  if (table.primaryStatusColumn && positiveCount !== null) {
    const countMetric: DeterministicAnalysisMetric = {
      metricKey: `${table.name}::positive_status_count`,
      label: `${table.primaryStatusColumn} positive count`,
      description: `Rows whose ${table.primaryStatusColumn} matches prepared positive values`,
      tableName: table.name,
      sourceColumns: [table.primaryStatusColumn],
      kind: "count",
      formula: `COUNT(${table.primaryStatusColumn} IN {${positiveStatusValues.join(", ")}})`,
      value: positiveCount,
      unit: "count",
      components: { positiveCount, positiveStatusValues },
    };
    metrics.push(countMetric);
    candidateIndicators.push({
      indicatorKey: countMetric.metricKey,
      label: `Positive ${table.primaryStatusColumn}`,
      description: countMetric.description,
      tableName: table.name,
      formula: countMetric.formula,
      value: countMetric.value,
      unit: countMetric.unit,
      sourceColumns: countMetric.sourceColumns,
      groundingNote:
        "Derived deterministically from the prepared primary status column and confirmed positive values.",
    });

    const ratio = rows.length > 0 ? positiveCount / rows.length : null;
    const ratioMetric: DeterministicAnalysisMetric = {
      metricKey: `${table.name}::positive_status_ratio`,
      label: `${table.primaryStatusColumn} positive ratio`,
      description: `Share of rows whose ${table.primaryStatusColumn} matches prepared positive values`,
      tableName: table.name,
      sourceColumns: [table.primaryStatusColumn],
      kind: "ratio",
      formula: `COUNT(${table.primaryStatusColumn} IN {${positiveStatusValues.join(", ")}}) / COUNT(rows)`,
      value: ratio,
      unit: "ratio",
      components: {
        numeratorCount: positiveCount,
        denominatorCount: rows.length,
        positiveStatusValues,
      },
    };
    metrics.push(ratioMetric);
    candidateIndicators.push({
      indicatorKey: ratioMetric.metricKey,
      label: `Positive ${table.primaryStatusColumn} rate`,
      description: ratioMetric.description,
      tableName: table.name,
      formula: ratioMetric.formula,
      value: ratioMetric.value,
      unit: ratioMetric.unit,
      sourceColumns: ratioMetric.sourceColumns,
      groundingNote:
        "Derived deterministically from the prepared primary status column and confirmed positive values.",
    });
  }

  return { metrics, candidateIndicators };
}

function buildBaseMetricsAndCandidates(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
): {
  metrics: DeterministicAnalysisMetric[];
  candidateIndicators: DeterministicAnalysisCandidateIndicator[];
} {
  const metrics: DeterministicAnalysisMetric[] = [];
  const candidateIndicators: DeterministicAnalysisCandidateIndicator[] = [];

  const totalRowsMetric: DeterministicAnalysisMetric = {
    metricKey: `${table.name}::total_rows`,
    label: `${table.name} rows`,
    description: `Total rows in ${table.name}`,
    tableName: table.name,
    sourceColumns: [],
    kind: "count",
    formula: "COUNT(rows)",
    value: rows.length,
    unit: "count",
    components: { rowCount: rows.length },
  };
  metrics.push(totalRowsMetric);
  candidateIndicators.push({
    indicatorKey: totalRowsMetric.metricKey,
    label: totalRowsMetric.label,
    description: totalRowsMetric.description,
    tableName: table.name,
    formula: totalRowsMetric.formula,
    value: totalRowsMetric.value,
    unit: totalRowsMetric.unit,
    sourceColumns: totalRowsMetric.sourceColumns,
    groundingNote: "Derived deterministically from prepared dataset row count.",
  });

  const distinctIdentifierCount = countDistinctNonNull(
    rows,
    table.identifierColumn,
  );
  if (table.identifierColumn && distinctIdentifierCount !== null) {
    const metric: DeterministicAnalysisMetric = {
      metricKey: `${table.name}::distinct_identifier_count`,
      label: `${table.identifierColumn} distinct count`,
      description: `Distinct non-null values in ${table.identifierColumn}`,
      tableName: table.name,
      sourceColumns: [table.identifierColumn],
      kind: "count_distinct",
      formula: `COUNT_DISTINCT(${table.identifierColumn})`,
      value: distinctIdentifierCount,
      unit: "count",
      components: { distinctCount: distinctIdentifierCount },
    };
    metrics.push(metric);
    candidateIndicators.push({
      indicatorKey: metric.metricKey,
      label: `Unique ${table.identifierColumn}`,
      description: metric.description,
      tableName: table.name,
      formula: metric.formula,
      value: metric.value,
      unit: metric.unit,
      sourceColumns: metric.sourceColumns,
      groundingNote:
        "Derived deterministically from prepared identifier column.",
    });
  }

  return { metrics, candidateIndicators };
}

function buildWarnings(
  preparedDataset: PreparedDatasetSnapshot,
): DeterministicAnalysisWarning[] {
  return preparedDataset.unresolvedRequirements.map((message, index) => ({
    code: `prepared_dataset_requirement_${index + 1}`,
    message,
  }));
}

function buildAnalysisInput(
  result: InterpretationResultPersistenceRecord,
  preparation: DatasetPreparationPersistenceRecord,
  privacySafePayload: Record<string, unknown>,
): DeterministicAnalysisUpsertInput {
  const preparedDataset = preparation.preparedDataset;
  if (!preparedDataset) {
    return {
      organizationId: result.organizationId,
      projectId: result.projectId,
      activityId: result.activityId,
      uploadMetadataId: result.uploadMetadataId,
      privacySafeRepresentationId: result.privacySafeRepresentationId,
      interpretationResultId: result.id,
      datasetPreparationId: preparation.id,
      status: "not_applicable",
      metrics: [],
      distributions: [],
      trends: [],
      subgroupBreakdowns: [],
      categoricalCrosstabs: [],
      numericCategorySummaries: [],
      numericCorrelations: [],
      warnings: [],
      candidateIndicators: [],
    };
  }

  if (
    (preparation.status !== "ready_for_analysis" &&
      preparation.status !== "analysis_completed") ||
    !preparedDataset.isReadyForDeterministicAnalysis
  ) {
    return {
      organizationId: result.organizationId,
      projectId: result.projectId,
      activityId: result.activityId,
      uploadMetadataId: result.uploadMetadataId,
      privacySafeRepresentationId: result.privacySafeRepresentationId,
      interpretationResultId: result.id,
      datasetPreparationId: preparation.id,
      status: "awaiting_preparation",
      metrics: [],
      distributions: [],
      trends: [],
      subgroupBreakdowns: [],
      categoricalCrosstabs: [],
      numericCategorySummaries: [],
      numericCorrelations: [],
      warnings: buildWarnings(preparedDataset),
      candidateIndicators: [],
    };
  }

  const payloadTablesByName = new Map(
    readTableRecords(privacySafePayload).map((table) => [
      typeof table.name === "string" ? table.name : "table",
      table,
    ]),
  );

  const metrics: DeterministicAnalysisMetric[] = [];
  const distributions: DeterministicAnalysisDistribution[] = [];
  const trends: DeterministicAnalysisTrend[] = [];
  const subgroupBreakdowns: DeterministicAnalysisSubgroupBreakdown[] = [];
  const categoricalCrosstabs: DeterministicAnalysisCategoricalCrosstab[] = [];
  const numericCategorySummaries: DeterministicAnalysisNumericCategorySummary[] =
    [];
  const numericCorrelations: DeterministicAnalysisNumericCorrelation[] = [];
  const warnings = buildWarnings(preparedDataset);
  const candidateIndicators: DeterministicAnalysisCandidateIndicator[] = [];

  for (const preparedTable of preparedDataset.tables) {
    const payloadTable = payloadTablesByName.get(preparedTable.name);
    const rows = readRowRecords(payloadTable?.rows);
    const positiveStatusColumn = preparedTable.columns.find(
      (column) => column.name === preparedTable.primaryStatusColumn,
    );
    const positiveStatusValues =
      positiveStatusColumn?.positiveStatusValues ?? [];
    const categoricalColumns = buildCategoricalColumns(preparedTable, rows);
    const numericColumns = buildNumericColumns(preparedTable, rows);

    const baseMetricOutput = buildBaseMetricsAndCandidates(preparedTable, rows);
    metrics.push(...baseMetricOutput.metrics);
    candidateIndicators.push(...baseMetricOutput.candidateIndicators);

    const categoricalMetricOutput = buildCategoricalValueMetricsAndCandidates(
      preparedTable,
      rows.length,
      categoricalColumns,
    );
    metrics.push(...categoricalMetricOutput.metrics);
    candidateIndicators.push(...categoricalMetricOutput.candidateIndicators);

    const primaryStatusOutput = buildPrimaryStatusMetricsAndCandidates(
      preparedTable,
      rows,
      positiveStatusValues,
    );
    metrics.push(...primaryStatusOutput.metrics);
    candidateIndicators.push(...primaryStatusOutput.candidateIndicators);

    const primaryStatusDistribution = buildStatusDistribution(preparedTable, rows);
    if (primaryStatusDistribution) {
      distributions.push(primaryStatusDistribution);
    }

    const categoricalDistributions = buildCategoricalDistributions(
      preparedTable,
      rows,
      categoricalColumns.filter(
        (column) => column.name !== preparedTable.primaryStatusColumn,
      ),
    );
    distributions.push(...categoricalDistributions);

    const trend = buildTrend(preparedTable, rows, positiveStatusValues);
    if (trend) {
      trends.push(trend);
    }

    subgroupBreakdowns.push(
      ...buildSubgroupBreakdowns(preparedTable, rows, positiveStatusValues),
    );
    categoricalCrosstabs.push(
      ...buildCategoricalCrosstabs(preparedTable, rows, categoricalColumns),
    );
    numericCategorySummaries.push(
      ...buildNumericCategorySummaries(
        preparedTable,
        rows,
        numericColumns,
        categoricalColumns,
      ),
    );
    numericCorrelations.push(
      ...buildNumericCorrelations(preparedTable, rows, numericColumns),
    );
  }

  return {
    organizationId: result.organizationId,
    projectId: result.projectId,
    activityId: result.activityId,
    uploadMetadataId: result.uploadMetadataId,
    privacySafeRepresentationId: result.privacySafeRepresentationId,
    interpretationResultId: result.id,
    datasetPreparationId: preparation.id,
    status: "ready",
    metrics,
    distributions,
    trends,
    subgroupBreakdowns,
    categoricalCrosstabs,
    numericCategorySummaries,
    numericCorrelations,
    warnings,
    candidateIndicators,
  };
}

export class DeterministicAnalysisService {
  constructor(
    private readonly deterministicAnalysisRepository: DeterministicAnalysisRepository,
    private readonly privacySafeRepresentationRepository: PrivacySafeRepresentationRepository,
  ) {}

  async syncForInterpretationResult(
    result: InterpretationResultPersistenceRecord,
    preparation: DatasetPreparationPersistenceRecord,
  ): Promise<DeterministicAnalysisPersistenceRecord> {
    const privacySafeRepresentation =
      await this.privacySafeRepresentationRepository.findById(
        result.privacySafeRepresentationId,
        databaseSession,
      );

    return this.deterministicAnalysisRepository.upsertByInterpretationResultId(
      buildAnalysisInput(
        result,
        preparation,
        privacySafeRepresentation?.payload ?? {},
      ),
      databaseSession,
    );
  }

  async findByInterpretationResultId(
    interpretationResultId: string,
  ): Promise<DeterministicAnalysisPersistenceRecord | null> {
    return this.deterministicAnalysisRepository.findByInterpretationResultId(
      interpretationResultId,
      databaseSession,
    );
  }

  async findByInterpretationResultIds(
    interpretationResultIds: string[],
  ): Promise<DeterministicAnalysisPersistenceRecord[]> {
    return this.deterministicAnalysisRepository.findByInterpretationResultIds(
      interpretationResultIds,
      databaseSession,
    );
  }
}
