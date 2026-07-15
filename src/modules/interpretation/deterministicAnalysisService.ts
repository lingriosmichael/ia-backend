import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DeterministicAnalysisCandidateIndicator,
  DeterministicAnalysisDistribution,
  DeterministicAnalysisDistributionBucket,
  DeterministicAnalysisMetric,
  DeterministicAnalysisStatus,
  DeterministicAnalysisSubgroupBreakdown,
  DeterministicAnalysisSubgroupSegment,
  DeterministicAnalysisTrend,
  DeterministicAnalysisTrendPoint,
  DeterministicAnalysisWarning,
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

function readTableRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(payload.tables)
    ? payload.tables.filter(
        (table): table is Record<string, unknown> =>
          Boolean(table) && typeof table === "object" && !Array.isArray(table),
      )
    : [];
}

function readColumnNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
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
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
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

function buildStatusDistribution(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
): DeterministicAnalysisDistribution | null {
  if (!table.primaryStatusColumn) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[table.primaryStatusColumn];
    if (value === null || value === undefined) {
      continue;
    }
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: DeterministicAnalysisDistributionBucket[] = Array.from(
    counts.entries(),
  )
    .sort((a, b) => b[1] - a[1])
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

  const points: DeterministicAnalysisTrendPoint[] = Array.from(rowsByMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
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
      const segmentsByValue = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const value = row[column.name];
        if (value === null || value === undefined) {
          continue;
        }
        const key = String(value);
        const bucket = segmentsByValue.get(key) ?? [];
        bucket.push(row);
        segmentsByValue.set(key, bucket);
      }

      const segments: DeterministicAnalysisSubgroupSegment[] = Array.from(
        segmentsByValue.entries(),
      )
        .sort((a, b) => b[1].length - a[1].length)
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

function buildMetricsAndCandidates(
  table: PreparedDatasetTable,
  rows: Record<string, unknown>[],
  positiveStatusValues: string[],
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

  const distinctIdentifierCount = countDistinctNonNull(rows, table.identifierColumn);
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
      groundingNote: "Derived deterministically from prepared identifier column.",
    });
  }

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
  const warnings = buildWarnings(preparedDataset);
  const candidateIndicators: DeterministicAnalysisCandidateIndicator[] = [];

  for (const preparedTable of preparedDataset.tables) {
    const payloadTable = payloadTablesByName.get(preparedTable.name);
    const rows = readRowRecords(payloadTable?.rows);
    const positiveStatusColumn = preparedTable.columns.find(
      (column) => column.name === preparedTable.primaryStatusColumn,
    );
    const positiveStatusValues = positiveStatusColumn?.positiveStatusValues ?? [];

    const metricOutput = buildMetricsAndCandidates(
      preparedTable,
      rows,
      positiveStatusValues,
    );
    metrics.push(...metricOutput.metrics);
    candidateIndicators.push(...metricOutput.candidateIndicators);

    const distribution = buildStatusDistribution(preparedTable, rows);
    if (distribution) {
      distributions.push(distribution);
    }

    const trend = buildTrend(preparedTable, rows, positiveStatusValues);
    if (trend) {
      trends.push(trend);
    }

    subgroupBreakdowns.push(
      ...buildSubgroupBreakdowns(preparedTable, rows, positiveStatusValues),
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
      buildAnalysisInput(result, preparation, privacySafeRepresentation?.payload ?? {}),
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
