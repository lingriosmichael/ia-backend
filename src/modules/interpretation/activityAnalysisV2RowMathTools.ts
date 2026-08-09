// Row-wise scalar math tools: derive_numeric_column and compare_columns.
// Split out of activityAnalysisV2ToolExecutor.ts (see that file for the
// module-split rationale and dependency order).
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import { toNumericValue } from "./deterministicAnalysisService.js";
import type {
  ActivityAnalysisV2ColumnComparisonOperation,
  ActivityAnalysisV2DerivedNumericOperation,
} from "./activityAnalysisV2ToolTypes.js";
import {
  buildCalculationId,
  type ActivityAnalysisV2ResolvedRowSource,
  type ActivityAnalysisV2RowAliasValue,
} from "./activityAnalysisV2ToolRowResolution.js";
import { createResultAliasValue } from "./activityAnalysisV2CoreRowTools.js";

export function applyDerivedNumericOperation(
  leftValue: number | null,
  rightValue: number | null,
  operation: ActivityAnalysisV2DerivedNumericOperation,
): number | null {
  if (leftValue === null || rightValue === null) {
    return null;
  }
  if (operation === "add") {
    return leftValue + rightValue;
  }
  if (operation === "subtract") {
    return leftValue - rightValue;
  }
  if (operation === "multiply") {
    return leftValue * rightValue;
  }
  return rightValue === 0 ? null : leftValue / rightValue;
}

export function executeDeriveNumericColumn(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  leftColumnName: string,
  rightColumnName: string,
  operation: ActivityAnalysisV2DerivedNumericOperation,
  outputColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const derivedRows = source.rows.map((row) => ({
    ...row,
    [outputColumnName]: applyDerivedNumericOperation(
      toNumericValue(row[leftColumnName]),
      toNumericValue(row[rightColumnName]),
      operation,
    ),
  }));
  const calculationId = buildCalculationId("derive_numeric_column", {
    alias,
    sourceLabel: source.sourceLabel,
    leftColumnName,
    rightColumnName,
    operation,
    outputColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: derivedRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "derive_numeric_column",
        label: `Derived numeric result ${alias}`,
        description:
          "Builds a reusable result with a derived numeric column from two existing numeric columns.",
        formula: `${leftColumnName} ${operation} ${rightColumnName}`,
        value: derivedRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [leftColumnName, rightColumnName, outputColumnName],
        grain: "row",
        numerator: derivedRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: derivedRows.length,
          leftColumnName,
          rightColumnName,
          operation,
          outputColumnName,
          sourceLabel: source.sourceLabel,
          basis: source.basis,
          filters: source.filters,
          rows: derivedRows,
        },
      },
    ],
  };
}

export function applyColumnComparison(
  leftValue: number | null,
  rightValue: number | null,
  comparison: ActivityAnalysisV2ColumnComparisonOperation,
): boolean | null {
  if (leftValue === null || rightValue === null) {
    return null;
  }
  if (comparison === "greater_than") {
    return leftValue > rightValue;
  }
  if (comparison === "greater_than_or_equal") {
    return leftValue >= rightValue;
  }
  if (comparison === "less_than") {
    return leftValue < rightValue;
  }
  if (comparison === "less_than_or_equal") {
    return leftValue <= rightValue;
  }
  if (comparison === "equal") {
    return leftValue === rightValue;
  }
  return leftValue !== rightValue;
}

export function executeCompareColumns(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  leftColumnName: string,
  rightColumnName: string,
  comparison: ActivityAnalysisV2ColumnComparisonOperation,
  outputColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const comparedRows = source.rows.map((row) => ({
    ...row,
    [outputColumnName]: applyColumnComparison(
      toNumericValue(row[leftColumnName]),
      toNumericValue(row[rightColumnName]),
      comparison,
    ),
  }));
  const calculationId = buildCalculationId("compare_columns", {
    alias,
    sourceLabel: source.sourceLabel,
    leftColumnName,
    rightColumnName,
    comparison,
    outputColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: comparedRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "compare_columns",
        label: `Compared-column result ${alias}`,
        description:
          "Builds a reusable result with a boolean comparison column from two numeric columns.",
        formula: `${leftColumnName} ${comparison} ${rightColumnName}`,
        value: comparedRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [leftColumnName, rightColumnName, outputColumnName],
        grain: "row",
        numerator: comparedRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: comparedRows.length,
          leftColumnName,
          rightColumnName,
          comparison,
          outputColumnName,
          sourceLabel: source.sourceLabel,
          basis: source.basis,
          filters: source.filters,
          rows: comparedRows,
        },
      },
    ],
  };
}
