// Temporal tool implementations: first_event, last_event, date_difference,
// event_gap, days_since_last_event, period_change, paired_change. Split
// out of activityAnalysisV2ToolExecutor.ts (see that file for the
// module-split rationale and dependency order).
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import {
  toCategoryValue,
  toNumericValue,
} from "./deterministicAnalysisService.js";
import {
  buildCalculationId,
  toDateValue,
  type ActivityAnalysisV2ResolvedRowSource,
  type ActivityAnalysisV2RowAliasValue,
} from "./activityAnalysisV2ToolRowResolution.js";
import { createResultAliasValue } from "./activityAnalysisV2CoreRowTools.js";
import { calculateMedian } from "./activityAnalysisV2AggregationAndSetTools.js";

export function executeBoundaryEvent(
  toolName: "first_event" | "last_event",
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  entityColumnName: string,
  dateColumnName: string,
  outputDateColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const rowsByEntity = new Map<
    string,
    { entityValue: string; eventDate: Date; originalValue: string }
  >();

  for (const row of source.rows) {
    const entityValue = toCategoryValue(row[entityColumnName]);
    const eventDate = toDateValue(row[dateColumnName]);
    const originalValue = toCategoryValue(row[dateColumnName]);
    if (!entityValue || !eventDate || !originalValue) {
      continue;
    }
    const existing = rowsByEntity.get(entityValue);
    if (!existing) {
      rowsByEntity.set(entityValue, { entityValue, eventDate, originalValue });
      continue;
    }
    const shouldReplace =
      toolName === "first_event"
        ? eventDate.getTime() < existing.eventDate.getTime()
        : eventDate.getTime() > existing.eventDate.getTime();
    if (shouldReplace) {
      rowsByEntity.set(entityValue, { entityValue, eventDate, originalValue });
    }
  }

  const boundaryRows = Array.from(rowsByEntity.values()).map((entry) => ({
    [entityColumnName]: entry.entityValue,
    [outputDateColumnName]: entry.originalValue,
  }));
  const calculationId = buildCalculationId(toolName, {
    alias,
    sourceLabel: source.sourceLabel,
    entityColumnName,
    dateColumnName,
    outputDateColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: boundaryRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName,
        label:
          toolName === "first_event"
            ? `First event result ${alias}`
            : `Last event result ${alias}`,
        description:
          toolName === "first_event"
            ? "Builds a reusable result containing the earliest event date per entity."
            : "Builds a reusable result containing the latest event date per entity.",
        formula: null,
        value: boundaryRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [entityColumnName, dateColumnName, outputDateColumnName],
        grain: "row",
        numerator: boundaryRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: boundaryRows.length,
          entityColumnName,
          dateColumnName,
          outputDateColumnName,
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: boundaryRows,
        },
      },
    ],
  };
}

export function calculateDateDifferenceInDays(
  startDate: Date | null,
  endDate: Date | null,
): number | null {
  if (!startDate || !endDate) {
    return null;
  }
  return (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
}

export function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDateWithinRange(
  date: Date,
  startDate: Date,
  endDate: Date,
): boolean {
  return (
    date.getTime() >= startDate.getTime() && date.getTime() <= endDate.getTime()
  );
}

export function executeDateDifference(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  startDateColumnName: string,
  endDateColumnName: string,
  outputColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const resultRows = source.rows.map((row) => ({
    ...row,
    [outputColumnName]: calculateDateDifferenceInDays(
      toDateValue(row[startDateColumnName]),
      toDateValue(row[endDateColumnName]),
    ),
  }));
  const calculationId = buildCalculationId("date_difference", {
    alias,
    sourceLabel: source.sourceLabel,
    startDateColumnName,
    endDateColumnName,
    outputColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: resultRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "date_difference",
        label: `Date difference result ${alias}`,
        description:
          "Builds a reusable result with a day-difference column between two date columns.",
        formula: `${endDateColumnName} - ${startDateColumnName}`,
        value: resultRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [
          startDateColumnName,
          endDateColumnName,
          outputColumnName,
        ],
        grain: "row",
        numerator: resultRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: resultRows.length,
          startDateColumnName,
          endDateColumnName,
          outputColumnName,
          unit: "days",
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: resultRows,
        },
      },
    ],
  };
}

export function executeEventGap(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  entityColumnName: string,
  dateColumnName: string,
  outputColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const datesByEntity = new Map<string, Date[]>();

  for (const row of source.rows) {
    const entityValue = toCategoryValue(row[entityColumnName]);
    const eventDate = toDateValue(row[dateColumnName]);
    if (!entityValue || !eventDate) {
      continue;
    }
    const current = datesByEntity.get(entityValue) ?? [];
    current.push(eventDate);
    datesByEntity.set(entityValue, current);
  }

  const resultRows = Array.from(datesByEntity.entries()).map(
    ([entityValue, dates]) => {
      const sortedDates = [...dates].sort(
        (left, right) => left.getTime() - right.getTime(),
      );
      let maxGapDays: number | null = null;
      for (let index = 1; index < sortedDates.length; index += 1) {
        const gapDays = calculateDateDifferenceInDays(
          sortedDates[index - 1] ?? null,
          sortedDates[index] ?? null,
        );
        if (gapDays === null) {
          continue;
        }
        maxGapDays =
          maxGapDays === null ? gapDays : Math.max(maxGapDays, gapDays);
      }
      return {
        [entityColumnName]: entityValue,
        [outputColumnName]: maxGapDays,
      };
    },
  );

  const maxGapDaysOverall = resultRows.reduce<number | null>((current, row) => {
    const gapDays = toNumericValue(row[outputColumnName]);
    if (gapDays === null) {
      return current;
    }
    return current === null ? gapDays : Math.max(current, gapDays);
  }, null);
  const entitiesWithComputedGapCount = resultRows.filter(
    (row) => toNumericValue(row[outputColumnName]) !== null,
  ).length;

  const calculationId = buildCalculationId("event_gap", {
    alias,
    sourceLabel: source.sourceLabel,
    entityColumnName,
    dateColumnName,
    outputColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: resultRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "event_gap",
        label: `Event gap result ${alias}`,
        description:
          "Builds a reusable result containing the maximum consecutive event gap in days per entity.",
        formula: null,
        value: resultRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [entityColumnName, dateColumnName, outputColumnName],
        grain: "row",
        numerator: resultRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: resultRows.length,
          entityColumnName,
          dateColumnName,
          outputColumnName,
          entitiesWithComputedGapCount,
          maxGapDaysOverall,
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: resultRows,
        },
      },
    ],
  };
}

export function executeDaysSinceLastEvent(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  entityColumnName: string,
  dateColumnName: string,
  outputColumnName: string,
  outputDateColumnName: string | undefined,
  referenceDateInput: string | undefined,
  // Falls back to when the whole run started rather than calling `new
  // Date()` fresh here. Without this, two days_since_last_event calls in
  // the same run (or this tool combined with others reading "now") could
  // silently disagree by however many milliseconds elapsed between them —
  // this pins every tool in a run to one consistent "as of" instant.
  runStartedAt: number,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const referenceDate = referenceDateInput
    ? toDateValue(referenceDateInput)
    : new Date(runStartedAt);
  if (!referenceDate) {
    throw new Error(
      "days_since_last_event requires a valid referenceDate when provided.",
    );
  }

  const lastEventByEntity = new Map<
    string,
    { entityValue: string; eventDate: Date; originalValue: string }
  >();
  for (const row of source.rows) {
    const entityValue = toCategoryValue(row[entityColumnName]);
    const eventDate = toDateValue(row[dateColumnName]);
    const originalValue = toCategoryValue(row[dateColumnName]);
    if (!entityValue || !eventDate || !originalValue) {
      continue;
    }
    const current = lastEventByEntity.get(entityValue);
    if (!current || eventDate.getTime() > current.eventDate.getTime()) {
      lastEventByEntity.set(entityValue, {
        entityValue,
        eventDate,
        originalValue,
      });
    }
  }

  const resultRows = Array.from(lastEventByEntity.values()).map((entry) => {
    const row: Record<string, unknown> = {
      [entityColumnName]: entry.entityValue,
      [outputColumnName]: calculateDateDifferenceInDays(
        entry.eventDate,
        referenceDate,
      ),
    };
    if (outputDateColumnName) {
      row[outputDateColumnName] = entry.originalValue;
    }
    return row;
  });

  const calculationId = buildCalculationId("days_since_last_event", {
    alias,
    sourceLabel: source.sourceLabel,
    entityColumnName,
    dateColumnName,
    outputColumnName,
    outputDateColumnName: outputDateColumnName ?? null,
    referenceDate: formatUtcDate(referenceDate),
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: resultRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "days_since_last_event",
        label: `Days since last event result ${alias}`,
        description:
          "Builds a reusable result containing days since the most recent event per entity.",
        formula: null,
        value: resultRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [
          entityColumnName,
          dateColumnName,
          ...(outputDateColumnName ? [outputDateColumnName] : []),
          outputColumnName,
        ],
        grain: "row",
        numerator: resultRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: resultRows.length,
          entityColumnName,
          dateColumnName,
          outputColumnName,
          outputDateColumnName: outputDateColumnName ?? null,
          referenceDate: formatUtcDate(referenceDate),
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: resultRows,
        },
      },
    ],
  };
}

export function executePeriodChange(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  dateColumnName: string,
  baselineStartDateInput: string,
  baselineEndDateInput: string,
  comparisonStartDateInput: string,
  comparisonEndDateInput: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const baselineStartDate = toDateValue(baselineStartDateInput);
  const baselineEndDate = toDateValue(baselineEndDateInput);
  const comparisonStartDate = toDateValue(comparisonStartDateInput);
  const comparisonEndDate = toDateValue(comparisonEndDateInput);
  if (
    !baselineStartDate ||
    !baselineEndDate ||
    !comparisonStartDate ||
    !comparisonEndDate
  ) {
    throw new Error(
      "period_change requires valid baseline and comparison date ranges.",
    );
  }
  if (baselineStartDate.getTime() > baselineEndDate.getTime()) {
    throw new Error(
      "period_change baselineStartDate must be on or before baselineEndDate.",
    );
  }
  if (comparisonStartDate.getTime() > comparisonEndDate.getTime()) {
    throw new Error(
      "period_change comparisonStartDate must be on or before comparisonEndDate.",
    );
  }

  let baselineCount = 0;
  let comparisonCount = 0;
  let validDateRowCount = 0;
  for (const row of source.rows) {
    const eventDate = toDateValue(row[dateColumnName]);
    if (!eventDate) {
      continue;
    }
    validDateRowCount += 1;
    if (isDateWithinRange(eventDate, baselineStartDate, baselineEndDate)) {
      baselineCount += 1;
    }
    if (isDateWithinRange(eventDate, comparisonStartDate, comparisonEndDate)) {
      comparisonCount += 1;
    }
  }

  const absoluteChange = comparisonCount - baselineCount;
  const percentChange =
    baselineCount === 0 ? null : absoluteChange / baselineCount;
  const resultRows = [
    {
      baseline_count: baselineCount,
      comparison_count: comparisonCount,
      absolute_change: absoluteChange,
      percent_change: percentChange,
    },
  ];

  const calculationId = buildCalculationId("period_change", {
    alias,
    sourceLabel: source.sourceLabel,
    dateColumnName,
    baselineStartDate: baselineStartDateInput,
    baselineEndDate: baselineEndDateInput,
    comparisonStartDate: comparisonStartDateInput,
    comparisonEndDate: comparisonEndDateInput,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: resultRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "period_change",
        label: `Period change result ${alias}`,
        description:
          "Builds a reusable summary result comparing row counts across two inclusive date windows.",
        formula: null,
        value: resultRows.length,
        unit: "rows",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [dateColumnName],
        grain: "row",
        numerator: resultRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          rowCount: resultRows.length,
          dateColumnName,
          baselineStartDate: baselineStartDateInput,
          baselineEndDate: baselineEndDateInput,
          comparisonStartDate: comparisonStartDateInput,
          comparisonEndDate: comparisonEndDateInput,
          baselineCount,
          comparisonCount,
          absoluteChange,
          percentChange,
          validDateRowCount,
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: resultRows,
        },
      },
    ],
  };
}

export function executePairedChange(
  alias: string,
  source: ActivityAnalysisV2ResolvedRowSource,
  entityColumnName: string,
  preColumnName: string,
  postColumnName: string,
  outputColumnName: string,
): {
  calculations: ActivityAnalysisV2CalculationRecord[];
  resultAlias: ActivityAnalysisV2RowAliasValue;
} {
  const pairedRows = source.rows
    .map((row) => {
      const preValue = toNumericValue(row[preColumnName]);
      const postValue = toNumericValue(row[postColumnName]);
      if (preValue === null || postValue === null) {
        return null;
      }
      return {
        ...row,
        [outputColumnName]: postValue - preValue,
      };
    })
    .filter((row): row is Record<string, unknown> => row !== null);

  const changes = pairedRows
    .map((row) => toNumericValue(row[outputColumnName]))
    .filter((value): value is number => value !== null);
  const preValues = pairedRows
    .map((row) => toNumericValue(row[preColumnName]))
    .filter((value): value is number => value !== null);
  const postValues = pairedRows
    .map((row) => toNumericValue(row[postColumnName]))
    .filter((value): value is number => value !== null);
  const improvedCount = changes.filter((value) => value > 0).length;
  const unchangedCount = changes.filter((value) => value === 0).length;
  const worsenedCount = changes.filter((value) => value < 0).length;
  const mean = (values: number[]) =>
    values.length > 0
      ? values.reduce((sum, current) => sum + current, 0) / values.length
      : null;

  const calculationId = buildCalculationId("paired_change", {
    alias,
    sourceLabel: source.sourceLabel,
    entityColumnName,
    preColumnName,
    postColumnName,
    outputColumnName,
    basis: source.basis,
  });
  const resultAlias = createResultAliasValue(alias, {
    ...source,
    rows: pairedRows,
    basis: "result",
  });
  return {
    resultAlias,
    calculations: [
      {
        calculationId,
        toolName: "paired_change",
        label: `Paired change result ${alias}`,
        description:
          "Builds a reusable paired-change result and summary from pre/post values on the same row.",
        formula: `${postColumnName} - ${preColumnName}`,
        value: pairedRows.length,
        unit: "pairs",
        sourceUploadMetadataIds: source.sourceUploadMetadataIds,
        sourceTableNames: source.sourceTableNames,
        sourceColumns: [
          entityColumnName,
          preColumnName,
          postColumnName,
          outputColumnName,
        ],
        grain: "row",
        numerator: pairedRows.length,
        denominator: null,
        denominatorType: "rows",
        identifierColumn: null,
        result: {
          resultAlias: alias,
          pairedCount: pairedRows.length,
          entityColumnName,
          preColumnName,
          postColumnName,
          outputColumnName,
          meanPre: mean(preValues),
          meanPost: mean(postValues),
          meanChange: mean(changes),
          medianChange: calculateMedian(changes),
          improvedCount,
          unchangedCount,
          worsenedCount,
          basis: source.basis,
          sourceLabel: source.sourceLabel,
          rows: pairedRows,
        },
      },
    ],
  };
}
