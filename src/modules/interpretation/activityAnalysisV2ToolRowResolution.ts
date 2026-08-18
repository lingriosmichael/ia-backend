// Shared row/alias resolution, filtering, and value-normalization helpers
// used across every ActivityAnalysisV2 tool-family module. This is the
// foundational layer other tool modules import from — it must not import
// from any of them (see activityAnalysisV2ToolExecutor.ts for the split
// rationale and module dependency order).
import { createHash } from "node:crypto";
import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2ToolName,
  EpistemicRole,
} from "../../shared/contracts.js";
import {
  resolveAnalysisRowContext,
  toCategoryValue,
  toNumericValue,
  type AnalysisRowContext,
} from "./deterministicAnalysisService.js";
import type {
  ActivityAnalysisV2FilterCondition,
  ActivityAnalysisV2FilterValue,
  ActivityAnalysisV2RowSourceReference,
  ActivityAnalysisV2TableContext,
} from "./activityAnalysisV2ToolTypes.js";

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

export function stableId(
  prefix: string,
  input: Record<string, unknown>,
): string {
  const normalized = JSON.stringify(sortJsonValue(input));
  const digest = createHash("sha1")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `${prefix}_${digest}`;
}

export function buildCalculationId(
  toolName: ActivityAnalysisV2ToolName,
  input: Record<string, unknown>,
): string {
  return stableId(`calc_${toolName}`, input);
}

export function buildToolCallId(
  toolName: ActivityAnalysisV2ToolName,
  ordinal: number,
  input: Record<string, unknown>,
): string {
  return stableId(`tool_${ordinal + 1}_${toolName}`, input);
}

export type ActivityAnalysisV2RowBasis =
  "raw_rows" | "analysis_rows" | "cohort" | "result";

export interface ActivityAnalysisV2ResolvedRowSource {
  sourceLabel: string;
  rows: Record<string, unknown>[];
  grain: AnalysisRowContext["grain"];
  denominatorType: AnalysisRowContext["denominatorType"];
  identifierColumn: string | null;
  sourceUploadMetadataIds: string[];
  sourceTableNames: string[];
  basis: ActivityAnalysisV2RowBasis;
  filters: ActivityAnalysisV2FilterCondition[];
  sourceColumnEpistemicRoles: NonNullable<
    ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
  >;
  epistemicRoles: EpistemicRole[];
}

export interface ActivityAnalysisV2RowAliasValue {
  alias: string;
  rows: Record<string, unknown>[];
  grain: AnalysisRowContext["grain"];
  denominatorType: AnalysisRowContext["denominatorType"];
  identifierColumn: string | null;
  sourceUploadMetadataIds: string[];
  sourceTableNames: string[];
  basis: ActivityAnalysisV2RowBasis;
  sourceColumnEpistemicRoles: NonNullable<
    ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
  >;
  epistemicRoles: EpistemicRole[];
}

// Dedupes by columnName+role (a column can legitimately appear once per
// distinct role across merged sources) and keeps the first-seen entry for
// a given key, so callers can pass e.g. [left, right] and let left's entry
// win on overlap. This is the one place that merges
// sourceColumnEpistemicRoles — every tool that joins or aggregates two row
// sources should call this instead of writing its own merge, since this
// data backs the epistemic-role security gate (see
// activityAnalysisV2EpistemicRoleGate.ts) and a second, subtly different
// merge implementation is exactly how that gate could silently diverge.
export function mergeSourceColumnEpistemicRoles(
  ...roleGroups: Array<
    | NonNullable<
        ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
      >
    | undefined
  >
): NonNullable<
  ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
> {
  const merged: NonNullable<
    ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
  > = [];
  const seen = new Set<string>();

  for (const group of roleGroups) {
    for (const entry of group ?? []) {
      const key = `${entry.columnName}::${entry.epistemicRole ?? "null"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
    }
  }

  return merged;
}

export function collectEpistemicRoles(
  sourceColumnEpistemicRoles: NonNullable<
    ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
  >,
): EpistemicRole[] {
  return Array.from(
    new Set(
      sourceColumnEpistemicRoles.flatMap((entry) =>
        entry.epistemicRole ? [entry.epistemicRole] : [],
      ),
    ),
  );
}

export function collectColumnEpistemicRolesForTables(
  tables: ActivityAnalysisV2TableContext[],
  uploadMetadataIds: string[],
  tableNames: string[],
  columnNames: string[],
): NonNullable<
  ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
> {
  const roleEntries: NonNullable<
    ActivityAnalysisV2CalculationRecord["sourceColumnEpistemicRoles"]
  > = [];
  const seen = new Set<string>();

  for (const uploadMetadataId of uploadMetadataIds) {
    for (const tableName of tableNames) {
      const table =
        tables.find(
          (candidate) =>
            candidate.uploadMetadataId === uploadMetadataId &&
            candidate.tableName === tableName,
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

  return roleEntries;
}

export function selectRows(
  rowContext: AnalysisRowContext,
  useAnalysisRows: boolean,
): Record<string, unknown>[] {
  return useAnalysisRows ? rowContext.analysisRows : rowContext.rawRows;
}

export function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBooleanLikeText(value: string): boolean | null {
  const normalized = normalizeComparableText(value);
  if (["true", "yes", "ja", "y", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "nein", "n", "0"].includes(normalized)) {
    return false;
  }
  return null;
}

export function normalizeFilterValue(
  value: ActivityAnalysisV2FilterValue,
): string | number | boolean | null {
  if (typeof value === "string") {
    return normalizeBooleanLikeText(value) ?? normalizeComparableText(value);
  }
  return value;
}

export function toFilterValues(
  value: ActivityAnalysisV2FilterCondition["value"],
): ActivityAnalysisV2FilterValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

export function matchesFilter(
  row: Record<string, unknown>,
  filter: ActivityAnalysisV2FilterCondition,
): boolean {
  const rowValue = row[filter.columnName];
  const categoryValue = toCategoryValue(rowValue);
  const numericValue = toNumericValue(rowValue);
  const filterValues = toFilterValues(filter.value);

  if (filter.operator === "is_null") {
    return categoryValue === null;
  }
  if (filter.operator === "is_not_null") {
    return categoryValue !== null;
  }
  if (filter.operator === "contains") {
    const needle = filterValues[0];
    return (
      typeof categoryValue === "string" &&
      typeof needle === "string" &&
      normalizeComparableText(categoryValue).includes(
        normalizeComparableText(needle),
      )
    );
  }

  if (
    filter.operator === "greater_than" ||
    filter.operator === "greater_than_or_equal" ||
    filter.operator === "less_than" ||
    filter.operator === "less_than_or_equal"
  ) {
    const threshold = toNumericValue(filterValues[0] ?? null);
    if (numericValue === null || threshold === null) {
      return false;
    }
    if (filter.operator === "greater_than") {
      return numericValue > threshold;
    }
    if (filter.operator === "greater_than_or_equal") {
      return numericValue >= threshold;
    }
    if (filter.operator === "less_than") {
      return numericValue < threshold;
    }
    return numericValue <= threshold;
  }

  const normalizedRowValue =
    typeof rowValue === "string"
      ? normalizeComparableText(rowValue)
      : rowValue === null || rowValue === undefined
        ? null
        : typeof rowValue === "number" || typeof rowValue === "boolean"
          ? rowValue
          : categoryValue;
  const normalizedFilterValues = new Set(
    filterValues.map((value) => normalizeFilterValue(value)),
  );

  if (filter.operator === "equals") {
    return normalizedFilterValues.has(
      normalizeFilterValue(normalizedRowValue as ActivityAnalysisV2FilterValue),
    );
  }
  if (filter.operator === "not_equals") {
    return !normalizedFilterValues.has(
      normalizeFilterValue(normalizedRowValue as ActivityAnalysisV2FilterValue),
    );
  }
  if (filter.operator === "in") {
    return normalizedFilterValues.has(
      normalizeFilterValue(normalizedRowValue as ActivityAnalysisV2FilterValue),
    );
  }
  if (filter.operator === "not_in") {
    return !normalizedFilterValues.has(
      normalizeFilterValue(normalizedRowValue as ActivityAnalysisV2FilterValue),
    );
  }
  return false;
}

export function applyFilters(
  rows: Record<string, unknown>[],
  filters: ActivityAnalysisV2FilterCondition[] | undefined,
): Record<string, unknown>[] {
  if (!filters || filters.length === 0) {
    return rows;
  }
  return rows.filter((row) =>
    filters.every((filter) => matchesFilter(row, filter)),
  );
}

export function resolveFallbackRowContext(
  rows: Record<string, unknown>[],
): AnalysisRowContext {
  return {
    rawRows: rows,
    analysisRows: rows,
    grain: "row",
    denominatorType: "rows",
    identifierColumn: null,
    rawRowCount: rows.length,
    analysisRowCount: rows.length,
  };
}

export function resolveTableRowContext(
  table: ActivityAnalysisV2TableContext,
): AnalysisRowContext {
  return table.preparedTable
    ? resolveAnalysisRowContext(table.preparedTable, table.rows)
    : resolveFallbackRowContext(table.rows);
}

export function resolveSourceRows(
  tables: ActivityAnalysisV2TableContext[],
  rowAliases: Map<string, ActivityAnalysisV2RowAliasValue>,
  reference: ActivityAnalysisV2RowSourceReference,
): ActivityAnalysisV2ResolvedRowSource {
  if (reference.cohortAlias) {
    const aliasValue = rowAliases.get(reference.cohortAlias);
    if (!aliasValue) {
      throw new Error(
        `Cohort alias ${reference.cohortAlias} is not available.`,
      );
    }
    return {
      sourceLabel: `cohort ${reference.cohortAlias}`,
      rows: applyFilters(aliasValue.rows, reference.filters),
      grain: aliasValue.grain,
      denominatorType: aliasValue.denominatorType,
      identifierColumn: aliasValue.identifierColumn,
      sourceUploadMetadataIds: aliasValue.sourceUploadMetadataIds,
      sourceTableNames: aliasValue.sourceTableNames,
      basis: aliasValue.basis,
      filters: reference.filters ?? [],
      sourceColumnEpistemicRoles: mergeSourceColumnEpistemicRoles(
        aliasValue.sourceColumnEpistemicRoles,
        collectColumnEpistemicRolesForTables(
          tables,
          aliasValue.sourceUploadMetadataIds,
          aliasValue.sourceTableNames,
          (reference.filters ?? []).map((filter) => filter.columnName),
        ),
      ),
      epistemicRoles: collectEpistemicRoles(
        mergeSourceColumnEpistemicRoles(
          aliasValue.sourceColumnEpistemicRoles,
          collectColumnEpistemicRolesForTables(
            tables,
            aliasValue.sourceUploadMetadataIds,
            aliasValue.sourceTableNames,
            (reference.filters ?? []).map((filter) => filter.columnName),
          ),
        ),
      ),
    };
  }

  if (reference.resultAlias) {
    const aliasValue = rowAliases.get(reference.resultAlias);
    if (!aliasValue) {
      throw new Error(
        `Result alias ${reference.resultAlias} is not available.`,
      );
    }
    return {
      sourceLabel: `result ${reference.resultAlias}`,
      rows: applyFilters(aliasValue.rows, reference.filters),
      grain: aliasValue.grain,
      denominatorType: aliasValue.denominatorType,
      identifierColumn: aliasValue.identifierColumn,
      sourceUploadMetadataIds: aliasValue.sourceUploadMetadataIds,
      sourceTableNames: aliasValue.sourceTableNames,
      basis: "result",
      filters: reference.filters ?? [],
      sourceColumnEpistemicRoles: mergeSourceColumnEpistemicRoles(
        aliasValue.sourceColumnEpistemicRoles,
        collectColumnEpistemicRolesForTables(
          tables,
          aliasValue.sourceUploadMetadataIds,
          aliasValue.sourceTableNames,
          (reference.filters ?? []).map((filter) => filter.columnName),
        ),
      ),
      epistemicRoles: collectEpistemicRoles(
        mergeSourceColumnEpistemicRoles(
          aliasValue.sourceColumnEpistemicRoles,
          collectColumnEpistemicRolesForTables(
            tables,
            aliasValue.sourceUploadMetadataIds,
            aliasValue.sourceTableNames,
            (reference.filters ?? []).map((filter) => filter.columnName),
          ),
        ),
      ),
    };
  }

  if (!reference.uploadMetadataId || !reference.tableName) {
    throw new Error(
      "A deterministic row source must provide either cohortAlias or uploadMetadataId/tableName.",
    );
  }
  const table = findTableOrThrow(
    tables,
    reference.uploadMetadataId,
    reference.tableName,
  );
  const rowContext = resolveTableRowContext(table);
  const useAnalysisRows = reference.useAnalysisRows ?? true;
  const filterColumnRoles = collectColumnEpistemicRolesForTables(
    tables,
    [table.uploadMetadataId],
    [table.tableName],
    (reference.filters ?? []).map((filter) => filter.columnName),
  );
  return {
    sourceLabel: table.tableName,
    rows: applyFilters(
      selectRows(rowContext, useAnalysisRows),
      reference.filters,
    ),
    grain: useAnalysisRows ? rowContext.grain : "row",
    denominatorType: useAnalysisRows ? rowContext.denominatorType : "rows",
    identifierColumn: rowContext.identifierColumn,
    sourceUploadMetadataIds: [table.uploadMetadataId],
    sourceTableNames: [table.tableName],
    basis: useAnalysisRows ? "analysis_rows" : "raw_rows",
    filters: reference.filters ?? [],
    sourceColumnEpistemicRoles: filterColumnRoles,
    epistemicRoles: collectEpistemicRoles(filterColumnRoles),
  };
}

export function requireScalarAliasValue(
  scalarAliases: Map<string, number | null>,
  alias: string,
  toolName: string,
): number {
  // The map never stores `undefined` (its value type is `number | null`),
  // so a `.get()` result of `undefined` unambiguously means the alias was
  // never produced by an earlier tool call.
  const value = scalarAliases.get(alias);
  if (value === undefined) {
    throw new Error(
      `${toolName} references an alias that has not been produced yet.`,
    );
  }
  if (value === null) {
    throw new Error(
      `${toolName} references alias "${alias}", which produced no numeric value. ` +
        "Refusing to substitute 0 for missing data.",
    );
  }
  return value;
}

export function resolveSetSourceColumnName(
  source: ActivityAnalysisV2ResolvedRowSource,
  explicitColumnName: string | undefined,
): string {
  if (explicitColumnName) {
    return explicitColumnName;
  }
  if (source.identifierColumn) {
    return source.identifierColumn;
  }
  throw new Error(
    `No identifier column is available for ${source.sourceLabel}.`,
  );
}

export function buildSetFromColumn(
  rows: Record<string, unknown>[],
  columnName: string,
): Set<string> {
  const values = new Set<string>();
  for (const row of rows) {
    const value = toCategoryValue(row[columnName]);
    if (value) {
      values.add(value);
    }
  }
  return values;
}

// Identifiers coming from two independently-produced files commonly differ
// only by case (e.g. "Maria123" vs "maria123"). Cross-table matching
// (set operations, joins) must not treat those as different members —
// unlike single-table exact-value reporting (count_distinct, filters on
// literal category values), which intentionally preserves case and is
// untouched by this normalization.
export function toCaseInsensitiveMatchValue(value: unknown): string | null {
  const categoryValue = toCategoryValue(value);
  return categoryValue === null ? null : categoryValue.toLowerCase();
}

export function buildCaseInsensitiveSetFromColumn(
  rows: Record<string, unknown>[],
  columnName: string,
): Set<string> {
  const values = new Set<string>();
  for (const row of rows) {
    const value = toCaseInsensitiveMatchValue(row[columnName]);
    if (value) {
      values.add(value);
    }
  }
  return values;
}

export function findTableOrThrow(
  tables: ActivityAnalysisV2TableContext[],
  uploadMetadataId: string,
  tableName: string,
): ActivityAnalysisV2TableContext {
  const table = tables.find(
    (entry) =>
      entry.uploadMetadataId === uploadMetadataId &&
      entry.tableName === tableName,
  );
  if (!table) {
    throw new Error(
      `Table ${tableName} for upload ${uploadMetadataId} is not available in the current evidence snapshot.`,
    );
  }
  return table;
}

export function countDistinctValues(
  rows: Record<string, unknown>[],
  columnName: string,
): number {
  return buildSetFromColumn(rows, columnName).size;
}

// Matches an ISO datetime string with no trailing 'Z'/offset, e.g.
// "2026-03-03T10:15:00" or "2026-03-03T10:15:00.123".
const ISO_DATE_TIME_WITHOUT_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function toDateValue(value: unknown): Date | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return null;
  }
  // Every downstream date tool buckets/compares using getUTC*, so parsing
  // must always resolve to UTC regardless of the server's configured
  // timezone. A date-only string ("2026-03-03") already parses as UTC
  // midnight per the Date constructor spec. A datetime string with no
  // 'Z'/offset suffix does NOT — the constructor parses that in the
  // server's local timezone instead, which would silently shift every
  // downstream day/month/quarter bucket if this service is ever deployed
  // outside UTC. Force UTC for that one ambiguous case.
  const normalizedValue =
    typeof value === "string" && ISO_DATE_TIME_WITHOUT_ZONE_PATTERN.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toTimeBucketKey(
  value: unknown,
  granularity: "day" | "week" | "month" | "quarter" | "year",
): string | null {
  const date = toDateValue(value);
  if (!date) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  if (granularity === "year") {
    return `${year}`;
  }
  if (granularity === "quarter") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `${year}-Q${quarter}`;
  }
  if (granularity === "month") {
    return `${year}-${month}`;
  }
  if (granularity === "day") {
    return `${year}-${month}-${day}`;
  }

  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + offset);
  const mondayYear = monday.getUTCFullYear();
  const mondayMonth = `${monday.getUTCMonth() + 1}`.padStart(2, "0");
  const mondayDay = `${monday.getUTCDate()}`.padStart(2, "0");
  return `${mondayYear}-W${mondayMonth}-${mondayDay}`;
}
