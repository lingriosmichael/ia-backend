import type { ActivityAnalysisV2QualitativeFindingRecord } from "../../shared/contracts.js";
import { toCategoryValue } from "./deterministicAnalysisService.js";
import {
  stableId,
  type ActivityAnalysisV2ResolvedRowSource,
} from "./activityAnalysisV2ToolRowResolution.js";

function buildThemeOrCode(
  source: ActivityAnalysisV2ResolvedRowSource,
  textColumnName: string,
): string | null {
  const thematicFilters = source.filters.filter(
    (filter) =>
      filter.columnName !== textColumnName &&
      (filter.operator === "equals" || filter.operator === "in") &&
      filter.value !== undefined,
  );
  if (thematicFilters.length === 0) {
    return null;
  }
  return thematicFilters
    .map((filter) => {
      const rawValue = Array.isArray(filter.value)
        ? filter.value.join(", ")
        : String(filter.value);
      return `${filter.columnName}=${rawValue}`;
    })
    .join("; ");
}

export function executeExcerptRetrieval(
  source: ActivityAnalysisV2ResolvedRowSource,
  columnName: string,
  limit: number,
): ActivityAnalysisV2QualitativeFindingRecord[] {
  const textRows = source.rows.flatMap((row) => {
    const verbatimText = toCategoryValue(row[columnName]);
    if (!verbatimText) {
      return [];
    }
    return [
      {
        sourceRowId: source.identifierColumn
          ? (toCategoryValue(row[source.identifierColumn]) ?? null)
          : null,
        verbatimText,
        sourceColumn: columnName,
      },
    ];
  });
  // `limit` comes from the planner LLM's tool-call arguments and is only
  // typed as `number`, not validated — clamp it here so a negative or
  // fractional value can't turn `slice` into "everything but the tail"
  // instead of a cap.
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  const cappedExcerpts = textRows.slice(0, safeLimit);
  const selectedRowCount = source.rows.length;
  const missingValuePct =
    selectedRowCount > 0
      ? ((selectedRowCount - textRows.length) / selectedRowCount) * 100
      : null;

  return [
    {
      findingId: stableId("finding_excerpt_retrieval", {
        sourceLabel: source.sourceLabel,
        columnName,
        basis: source.basis,
        limit,
        filters: source.filters,
      }),
      toolName: "excerpt_retrieval",
      label: `Excerpt evidence from ${columnName} in ${source.sourceLabel}`,
      description:
        "Retrieves grounded verbatim excerpts from a qualitative text column after deterministic filtering.",
      themeOrCode: buildThemeOrCode(source, columnName),
      excerpts: cappedExcerpts,
      totalMatchingRows: textRows.length,
      excerptsReturned: cappedExcerpts.length,
      frequency: {
        count: textRows.length,
        denominator: selectedRowCount,
        denominatorType: source.denominatorType,
      },
      codingMethod: "source_provided",
      reliabilitySignal: {
        missingValuePct,
        raterCount: "unknown",
      },
      sourceUploadMetadataIds: source.sourceUploadMetadataIds,
      sourceTableNames: source.sourceTableNames,
      sourceColumns: [columnName],
      sourceColumnEpistemicRoles: source.sourceColumnEpistemicRoles.filter(
        (entry) => entry.columnName === columnName,
      ),
      identifierColumn: source.identifierColumn,
    },
  ];
}
