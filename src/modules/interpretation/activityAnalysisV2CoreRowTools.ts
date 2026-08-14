// Core row/cohort/join tool implementations: describe_evidence,
// create_cohort, filter_result, count_distinct_keys, join_tables, and
// anti_join. Split out of activityAnalysisV2ToolExecutor.ts (see that
// file for the module-split rationale and dependency order).
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import {
  toCategoryValue,
  type AnalysisRowContext,
} from "./deterministicAnalysisService.js";
import type {
  ActivityAnalysisV2JoinKey,
  ActivityAnalysisV2TableContext,
} from "./activityAnalysisV2ToolTypes.js";
import {
  buildCalculationId,
  countDistinctValues,
  resolveTableRowContext,
  toCaseInsensitiveMatchValue,
  type ActivityAnalysisV2ResolvedRowSource,
  type ActivityAnalysisV2RowAliasValue,
} from "./activityAnalysisV2ToolRowResolution.js";

export function buildDescribeEvidenceCalculation(
  table: ActivityAnalysisV2TableContext,
  rowContext: AnalysisRowContext,
): ActivityAnalysisV2CalculationRecord {
  const calculationId = buildCalculationId("describe_evidence", {
    uploadMetadataId: table.uploadMetadataId,
    tableName: table.tableName,
  });
  const identifierColumn = rowContext.identifierColumn;
  const identifierDistinctCount = identifierColumn
    ? countDistinctValues(rowContext.analysisRows, identifierColumn)
    : null;
  return {
    calculationId,
    toolName: "describe_evidence",
    label: `Evidence overview for ${table.tableName}`,
    description:
      "Current evidence table metadata, row counts, and row-grain basis for ActivityAnalystV2.",
    formula: null,
    value: rowContext.analysisRowCount,
    unit: "rows",
    sourceUploadMetadataIds: [table.uploadMetadataId],
    sourceTableNames: [table.tableName],
    sourceColumns: identifierColumn ? [identifierColumn] : [],
    grain: rowContext.grain,
    numerator: rowContext.analysisRowCount,
    denominator: null,
    denominatorType: rowContext.denominatorType,
    identifierColumn,
    result: {
      rawRowCount: rowContext.rawRowCount,
      analysisRowCount: rowContext.analysisRowCount,
      columnCount:
        table.preparedTable?.columnCount ??
        Object.keys(table.rows[0] ?? {}).length,
      identifierColumn,
      identifierHandling: table.preparedTable?.identifierHandling ?? null,
      identifierDistinctCount,
      primaryStatusColumn: table.preparedTable?.primaryStatusColumn ?? null,
      evidenceModalityReady:
        table.preparedTable?.selectedRowGrain !== undefined ||
        table.preparedTable !== null,
    },
  };
}

export function executeDescribeEvidence(
  tables: ActivityAnalysisV2TableContext[],
): ActivityAnalysisV2CalculationRecord[] {
  return tables.map((table) =>
    buildDescribeEvidenceCalculation(table, resolveTableRowContext(table)),
  );
}

export function createCohortAliasValue(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
): ActivityAnalysisV2RowAliasValue {
  return {
    alias,
    rows: source.rows,
    grain: source.grain,
    denominatorType: source.denominatorType,
    identifierColumn: source.identifierColumn,
    sourceUploadMetadataIds: source.sourceUploadMetadataIds,
    sourceTableNames: source.sourceTableNames,
    basis: "cohort",
    sourceColumnEpistemicRoles: source.sourceColumnEpistemicRoles,
    epistemicRoles: source.epistemicRoles,
  };
}

export function createResultAliasValue(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
): ActivityAnalysisV2RowAliasValue {
  return {
    alias,
    rows: source.rows,
    grain: "row",
    denominatorType: "rows",
    identifierColumn: null,
    sourceUploadMetadataIds: source.sourceUploadMetadataIds,
    sourceTableNames: source.sourceTableNames,
    basis: "result",
    sourceColumnEpistemicRoles: source.sourceColumnEpistemicRoles,
    epistemicRoles: source.epistemicRoles,
  };
}

export function executeCreateCohort(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
): ActivityAnalysisV2CalculationRecord[] {
  const calculationId = buildCalculationId("create_cohort", {
    alias,
    sourceLabel: source.sourceLabel,
    basis: source.basis,
    count: source.rows.length,
  });
  return [
    {
      calculationId,
      toolName: "create_cohort",
      label: `Cohort ${alias}`,
      description:
        "Creates a reusable deterministic cohort from a table or prior cohort alias.",
      formula: null,
      value: source.rows.length,
      unit:
        source.denominatorType === "distinct_entities"
          ? "distinct_entities"
          : "rows",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [],
      grain: source.grain,
      numerator: source.rows.length,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        cohortAlias: alias,
        count: source.rows.length,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function executeFilterResult(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
): ActivityAnalysisV2CalculationRecord[] {
  const calculationId = buildCalculationId("filter_result", {
    alias,
    sourceLabel: source.sourceLabel,
    basis: source.basis,
    count: source.rows.length,
  });
  return [
    {
      calculationId,
      toolName: "filter_result",
      label: `Filtered result ${alias}`,
      description:
        "Creates a reusable filtered deterministic result from a prior source.",
      formula: null,
      value: source.rows.length,
      unit: "rows",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [],
      grain: "row",
      numerator: source.rows.length,
      denominator: null,
      denominatorType: "rows",
      identifierColumn: null,
      result: {
        resultAlias: alias,
        count: source.rows.length,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function buildCompositeKey(
  row: Record<string, unknown>,
  columnNames: string[],
): string | null {
  const values = columnNames.map((columnName) =>
    toCategoryValue(row[columnName]),
  );
  if (values.every((value) => value === null)) {
    return null;
  }
  return JSON.stringify(values);
}

// Used for join_tables/anti_join matching specifically: two independently
// uploaded files commonly key the same real-world entity with identifiers
// that differ only by case. count_distinct_keys keeps the exact-match
// buildCompositeKey above unchanged, since that tool reports on literal
// values within a single source rather than matching across two sources.
export function buildCompositeMatchKey(
  row: Record<string, unknown>,
  columnNames: string[],
): string | null {
  const values = columnNames.map((columnName) =>
    toCaseInsensitiveMatchValue(row[columnName]),
  );
  if (values.every((value) => value === null)) {
    return null;
  }
  return JSON.stringify(values);
}

export function countDistinctCompositeKeys(
  rows: Record<string, unknown>[],
  columnNames: string[],
): number {
  const values = new Set<string>();
  for (const row of rows) {
    const key = buildCompositeKey(row, columnNames);
    if (key) {
      values.add(key);
    }
  }
  return values.size;
}

export function executeCountDistinctKeys(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnNames: string[],
): ActivityAnalysisV2CalculationRecord[] {
  const distinctCount = countDistinctCompositeKeys(source.rows, columnNames);
  const calculationId = buildCalculationId("count_distinct_keys", {
    sourceLabel: source.sourceLabel,
    columnNames,
    basis: source.basis,
  });
  return [
    {
      calculationId,
      toolName: "count_distinct_keys",
      label: `Distinct key count for ${columnNames.join(", ")} in ${source.sourceLabel}`,
      description: "Counts distinct composite keys across multiple columns.",
      formula: `COUNT_DISTINCT_KEYS(${columnNames.join(", ")})`,
      value: distinctCount,
      unit: "distinct_keys",
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: columnNames,
      grain: source.grain,
      numerator: distinctCount,
      denominator: null,
      denominatorType: source.denominatorType,
      identifierColumn: source.identifierColumn,
      result: {
        distinctCount,
        columnNames,
        basis: source.basis,
        sourceLabel: source.sourceLabel,
        filters: source.filters,
      },
    },
  ];
}

export function createRightRowIndex(
  rows: Record<string, unknown>[],
  keys: ActivityAnalysisV2JoinKey[],
): Map<string, Record<string, unknown>[]> {
  const index = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = buildCompositeMatchKey(
      row,
      keys.map((entry) => entry.rightColumnName),
    );
    if (!key) {
      continue;
    }
    const current = index.get(key) ?? [];
    current.push(row);
    index.set(key, current);
  }
  return index;
}

export function buildJoinedRow(input: {
  leftRow: Record<string, unknown>;
  rightRow: Record<string, unknown>;
  keys: ActivityAnalysisV2JoinKey[];
  leftPrefix: string;
  rightPrefix: string;
}): Record<string, unknown> {
  const joinKeyNames = new Set(
    input.keys.flatMap((key) => [key.leftColumnName, key.rightColumnName]),
  );
  const joined: Record<string, unknown> = {};

  for (const key of input.keys) {
    joined[key.leftColumnName] = input.leftRow[key.leftColumnName] ?? null;
    if (key.rightColumnName !== key.leftColumnName) {
      joined[key.rightColumnName] = input.rightRow[key.rightColumnName] ?? null;
    }
  }

  for (const [columnName, value] of Object.entries(input.leftRow)) {
    if (joinKeyNames.has(columnName)) {
      continue;
    }
    joined[`${input.leftPrefix}_${columnName}`] = value;
  }
  for (const [columnName, value] of Object.entries(input.rightRow)) {
    if (joinKeyNames.has(columnName)) {
      continue;
    }
    joined[`${input.rightPrefix}_${columnName}`] = value;
  }

  return joined;
}

export function executeJoinTables(
  alias: string,
  leftSource: ActivityAnalysisV2ResolvedRowSource,
  rightSource: ActivityAnalysisV2ResolvedRowSource,
  keys: ActivityAnalysisV2JoinKey[],
  leftPrefix: string,
  rightPrefix: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const rightIndex = createRightRowIndex(rightSource.rows, keys);
  const joinedRows: Record<string, unknown>[] = [];
  let matchCount = 0;

  for (const leftRow of leftSource.rows) {
    const key = buildCompositeMatchKey(
      leftRow,
      keys.map((entry) => entry.leftColumnName),
    );
    if (!key) {
      continue;
    }
    const matchingRightRows = rightIndex.get(key) ?? [];
    if (matchingRightRows.length === 0) {
      continue;
    }
    for (const rightRow of matchingRightRows) {
      joinedRows.push(
        buildJoinedRow({
          leftRow,
          rightRow,
          keys,
          leftPrefix,
          rightPrefix,
        }),
      );
      matchCount += 1;
    }
  }

  const calculationId = buildCalculationId("join_tables", {
    alias,
    leftSourceLabel: leftSource.sourceLabel,
    rightSourceLabel: rightSource.sourceLabel,
    keys,
    leftPrefix,
    rightPrefix,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...leftSource,
    rows: joinedRows,
    basis: "result",
    grain: "row",
    denominatorType: "rows",
    identifierColumn: null,
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
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "join_tables",
        label: `Joined result ${alias}`,
        description:
          "Builds a reusable deterministic joined result using explicit key mappings.",
        formula: null,
        value: joinedRows.length,
        unit: "rows",
        sourceUploadMetadataIds: resultAlias.sourceUploadMetadataIds,
        sourceTableNames: resultAlias.sourceTableNames,
        sourceColumns: [
          ...keys.map((entry) => entry.leftColumnName),
          ...keys.map((entry) => entry.rightColumnName),
        ],
        grain: "row",
        numerator: joinedRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: joinedRows.length,
          matchCount,
          keys,
          leftSourceLabel: leftSource.sourceLabel,
          rightSourceLabel: rightSource.sourceLabel,
          leftPrefix,
          rightPrefix,
          rows: joinedRows,
        },
      },
    ],
  };
}

export function executeAntiJoin(
  alias: string,
  leftSource: ActivityAnalysisV2ResolvedRowSource,
  rightSource: ActivityAnalysisV2ResolvedRowSource,
  keys: ActivityAnalysisV2JoinKey[],
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const rightIndex = createRightRowIndex(rightSource.rows, keys);
  const remainingRows = leftSource.rows.filter((leftRow) => {
    const key = buildCompositeMatchKey(
      leftRow,
      keys.map((entry) => entry.leftColumnName),
    );
    if (!key) {
      return true;
    }
    return !rightIndex.has(key);
  });

  const calculationId = buildCalculationId("anti_join", {
    alias,
    leftSourceLabel: leftSource.sourceLabel,
    rightSourceLabel: rightSource.sourceLabel,
    keys,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...leftSource,
    rows: remainingRows,
    basis: "result",
    grain: "row",
    denominatorType: "rows",
    identifierColumn: null,
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "anti_join",
        label: `Anti-join result ${alias}`,
        description:
          "Builds a reusable deterministic result from left-side rows with no right-side match on the explicit keys.",
        formula: null,
        value: remainingRows.length,
        unit: "rows",
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
        sourceColumns: [
          ...keys.map((entry) => entry.leftColumnName),
          ...keys.map((entry) => entry.rightColumnName),
        ],
        grain: "row",
        numerator: remainingRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: remainingRows.length,
          keys,
          leftSourceLabel: leftSource.sourceLabel,
          rightSourceLabel: rightSource.sourceLabel,
          rows: remainingRows,
        },
      },
    ],
  };
}
