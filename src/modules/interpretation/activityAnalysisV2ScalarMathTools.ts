// Scalar math tool implementations: calculate_ratio, calculate_difference,
// calculate_percent_change, calculate_sum, calculate_product, and
// compare_target. Split out of activityAnalysisV2ToolExecutor.ts (see that
// file for the module-split rationale and dependency order).
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import { buildCalculationId } from "./activityAnalysisV2ToolRowResolution.js";

export function executeCalculateRatio(
  numerator: number,
  denominator: number,
  label?: string,
): ActivityAnalysisV2CalculationRecord[] {
  const value = denominator === 0 ? null : numerator / denominator;
  const calculationId = buildCalculationId("calculate_ratio", {
    numerator,
    denominator,
    label: label ?? null,
  });
  return [
    {
      calculationId,
      toolName: "calculate_ratio",
      label: label ?? "Calculated ratio",
      description:
        "Computes a ratio from a provided numerator and denominator.",
      formula: `${numerator} / ${denominator}`,
      value,
      unit: "ratio",
      sourceUploadMetadataIds: [],
      sourceTableNames: [],
      sourceColumns: [],
      numerator,
      denominator,
      denominatorType: "rows",
      result: {
        numerator,
        denominator,
        ratio: value,
      },
    },
  ];
}

export function executeCalculateDifference(
  minuend: number,
  subtrahend: number,
  label?: string,
): ActivityAnalysisV2CalculationRecord[] {
  const value = minuend - subtrahend;
  const calculationId = buildCalculationId("calculate_difference", {
    minuend,
    subtrahend,
    label: label ?? null,
  });
  return [
    {
      calculationId,
      toolName: "calculate_difference",
      label: label ?? "Calculated difference",
      description:
        "Computes the difference between two provided scalar values.",
      formula: `${minuend} - ${subtrahend}`,
      value,
      unit: null,
      sourceUploadMetadataIds: [],
      sourceTableNames: [],
      sourceColumns: [],
      numerator: minuend,
      denominator: subtrahend,
      denominatorType: "rows",
      result: {
        minuend,
        subtrahend,
        difference: value,
      },
    },
  ];
}

export function executeCalculatePercentChange(
  baseline: number,
  current: number,
  label?: string,
): ActivityAnalysisV2CalculationRecord[] {
  const value = baseline === 0 ? null : (current - baseline) / baseline;
  const calculationId = buildCalculationId("calculate_percent_change", {
    baseline,
    current,
    label: label ?? null,
  });
  return [
    {
      calculationId,
      toolName: "calculate_percent_change",
      label: label ?? "Calculated percent change",
      description:
        "Computes percent change from a baseline scalar value to a current scalar value.",
      formula:
        baseline === 0 ? null : `(${current} - ${baseline}) / ${baseline}`,
      value,
      unit: "ratio",
      sourceUploadMetadataIds: [],
      sourceTableNames: [],
      sourceColumns: [],
      numerator: current - baseline,
      denominator: baseline,
      denominatorType: "rows",
      result: {
        baseline,
        current,
        percentChange: value,
      },
    },
  ];
}

export function executeCalculateSumOrProduct(
  toolName: "calculate_sum" | "calculate_product",
  operands: number[],
  label?: string,
): ActivityAnalysisV2CalculationRecord[] {
  const value =
    toolName === "calculate_sum"
      ? operands.reduce((sum, current) => sum + current, 0)
      : operands.reduce((product, current) => product * current, 1);
  const calculationId = buildCalculationId(toolName, {
    operands,
    label: label ?? null,
  });
  return [
    {
      calculationId,
      toolName,
      label:
        label ??
        (toolName === "calculate_sum"
          ? "Calculated sum"
          : "Calculated product"),
      description:
        toolName === "calculate_sum"
          ? "Computes the sum of provided scalar values."
          : "Computes the product of provided scalar values.",
      formula:
        toolName === "calculate_sum"
          ? operands.join(" + ")
          : operands.join(" * "),
      value,
      unit: null,
      sourceUploadMetadataIds: [],
      sourceTableNames: [],
      sourceColumns: [],
      numerator: value,
      denominator: operands.length,
      denominatorType: "rows",
      result: {
        operands,
        value,
      },
    },
  ];
}

export function executeCompareTarget(
  value: number,
  target: number,
  comparison: "at_least" | "at_most" | "equal",
  label?: string,
): ActivityAnalysisV2CalculationRecord[] {
  const achieved =
    comparison === "at_least"
      ? value >= target
      : comparison === "at_most"
        ? value <= target
        : value === target;
  const gap = comparison === "at_most" ? target - value : value - target;
  const calculationId = buildCalculationId("compare_target", {
    value,
    target,
    comparison,
    label: label ?? null,
  });
  return [
    {
      calculationId,
      toolName: "compare_target",
      label: label ?? "Target comparison",
      description: "Compares a measured value against a target threshold.",
      formula: `${value} ${comparison} ${target}`,
      value: achieved,
      unit: null,
      sourceUploadMetadataIds: [],
      sourceTableNames: [],
      sourceColumns: [],
      numerator: value,
      denominator: target,
      denominatorType: "rows",
      result: {
        achieved,
        gap,
        comparison,
        value,
        target,
      },
    },
  ];
}
