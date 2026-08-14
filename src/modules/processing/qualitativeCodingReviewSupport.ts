import type {
  DatasetProfile,
  EpistemicRole,
  PreparedDatasetTable,
} from "../../shared/contracts.js";
import type { QualitativeCodingReviewDecisions } from "../../shared/contracts.js";

// Keep this aligned with ia_python_service/app/processing/qualitative_coding_review.py.
const MIN_NON_EMPTY_ROWS_FOR_QUALITATIVE_CODING_REVIEW = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ApprovedQualitativeCodingOverlay = {
  tableName: string;
  textColumnName: string;
  syntheticCodeColumnName: string;
  assignments: Array<{
    rowIndex: number;
    assignedCode: string | null;
  }>;
};

export type SyntheticQualitativeCodeColumnMetadata = {
  name: string;
  sourceTextColumnName: string;
  epistemicRole: Extract<EpistemicRole, "subjective_code">;
  inferredType: "categorical";
};

function readFindingsSummary(
  findings: Record<string, unknown>,
): Record<string, unknown>[] {
  return readRecordArray(findings.summary);
}

type QualitativeCodingReviewLike = {
  status: "pending" | "approved" | "rejected";
  findings: Record<string, unknown>;
  decisions: QualitativeCodingReviewDecisions | null;
};

function approvedDecisionKeys(
  review: QualitativeCodingReviewLike,
): Set<string> {
  return new Set(
    (review.decisions?.columnDecisions ?? [])
      .filter((decision) => decision.decision === "approve_as_proposed")
      .map((decision) => decision.findingKey),
  );
}

export function extractApprovedQualitativeCodingOverlays(
  review: QualitativeCodingReviewLike | null,
): ApprovedQualitativeCodingOverlay[] {
  if (!review || review.status !== "approved") {
    return [];
  }

  const approvedKeys = approvedDecisionKeys(review);
  return readFindingsSummary(review.findings)
    .filter((finding) => {
      const findingKey = readString(finding.findingKey);
      return Boolean(findingKey && approvedKeys.has(findingKey));
    })
    .map((finding) => ({
      tableName: readString(finding.tableName) ?? "table",
      textColumnName: readString(finding.textColumnName) ?? "text",
      syntheticCodeColumnName:
        readString(finding.syntheticCodeColumnName) ?? "coded_column",
      assignments: readRecordArray(finding.proposedAssignments).map(
        (assignment) => ({
          rowIndex: readNumber(assignment.rowIndex) ?? -1,
          assignedCode: readNullableString(assignment.assignedCode),
        }),
      ),
    }))
    .filter((overlay) =>
      overlay.assignments.every((entry) => entry.rowIndex >= 0),
    );
}

export function augmentPrivacySafePayloadWithApprovedQualitativeCodingReview(
  payload: Record<string, unknown>,
  review: QualitativeCodingReviewLike | null,
): Record<string, unknown> {
  const overlays = extractApprovedQualitativeCodingOverlays(review);
  if (overlays.length === 0) {
    return payload;
  }

  const tables = readRecordArray(payload.tables).map((table) => {
    const tableName = readString(table.name) ?? "table";
    const matchingOverlays = overlays.filter(
      (overlay) => overlay.tableName === tableName,
    );
    if (matchingOverlays.length === 0) {
      return table;
    }

    const rows = readRecordArray(table.rows).map((row) => ({ ...row }));
    const existingColumns = Array.isArray(table.columns)
      ? table.columns.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const syntheticColumnMetadata: SyntheticQualitativeCodeColumnMetadata[] =
      [];

    for (const overlay of matchingOverlays) {
      const assignmentsByRowIndex = new Map(
        overlay.assignments.map((entry) => [
          entry.rowIndex,
          entry.assignedCode,
        ]),
      );
      for (const [rowIndex, row] of rows.entries()) {
        row[overlay.syntheticCodeColumnName] =
          assignmentsByRowIndex.get(rowIndex) ?? null;
      }
      if (!existingColumns.includes(overlay.syntheticCodeColumnName)) {
        existingColumns.push(overlay.syntheticCodeColumnName);
      }
      syntheticColumnMetadata.push({
        name: overlay.syntheticCodeColumnName,
        sourceTextColumnName: overlay.textColumnName,
        epistemicRole: "subjective_code",
        inferredType: "categorical",
      });
    }

    return {
      ...table,
      columns: existingColumns,
      rows,
      sampleRows: rows.slice(0, 5),
      syntheticColumnMetadata,
    };
  });

  return {
    ...payload,
    tables,
  };
}

export function extractSyntheticQualitativeCodeColumnMetadata(
  table: Record<string, unknown>,
): SyntheticQualitativeCodeColumnMetadata[] {
  return readRecordArray(table.syntheticColumnMetadata)
    .map((entry) => {
      const name = readString(entry.name);
      const sourceTextColumnName = readString(entry.sourceTextColumnName);
      if (!name || !sourceTextColumnName) {
        return null;
      }
      return {
        name,
        sourceTextColumnName,
        epistemicRole: "subjective_code" as const,
        inferredType: "categorical" as const,
      };
    })
    .filter((entry): entry is SyntheticQualitativeCodeColumnMetadata =>
      Boolean(entry),
    );
}

export function preparedDatasetTableWithSyntheticColumns(
  preparedTable: PreparedDatasetTable | null,
  syntheticColumns: SyntheticQualitativeCodeColumnMetadata[],
): PreparedDatasetTable | null {
  if (!preparedTable || syntheticColumns.length === 0) {
    return preparedTable;
  }

  const existingNames = new Set(
    preparedTable.columns.map((column) => column.name),
  );
  return {
    ...preparedTable,
    columns: [
      ...preparedTable.columns,
      ...syntheticColumns
        .filter((column) => !existingNames.has(column.name))
        .map((column) => ({
          name: column.name,
          inferredType: column.inferredType,
          role: "other" as const,
          positiveStatusValues: [],
          positiveStatusDefinitionText: null,
          normalizationAccepted: null,
          epistemicRole: column.epistemicRole,
        })),
    ],
  };
}

export type QualitativeCodingReviewRequirementStatus =
  "not_required" | "required_pending" | "required_approved";

function readApproximateNonEmptyRowCount(
  column: DatasetProfile["tables"][number]["columns"][number],
  table: DatasetProfile["tables"][number],
): number {
  const runtimeColumn = column as unknown as Record<string, unknown>;
  return readNumber(runtimeColumn.nonNullCount) ?? table.rowCount;
}

export function requiresQualitativeCodingReview(
  datasetProfile: DatasetProfile | null,
): boolean {
  return (datasetProfile?.tables ?? []).some((table) => {
    const hasSubjectiveCode = table.columns.some(
      (column) => column.epistemicRole === "subjective_code",
    );
    const hasFreeText = table.columns.some(
      (column) =>
        column.epistemicRole === "free_text" &&
        readApproximateNonEmptyRowCount(column, table) >=
          MIN_NON_EMPTY_ROWS_FOR_QUALITATIVE_CODING_REVIEW,
    );
    return hasFreeText && !hasSubjectiveCode;
  });
}

export function qualitativeCodingReviewRequirementStatus(
  datasetProfile: DatasetProfile | null,
  review: QualitativeCodingReviewLike | null,
): QualitativeCodingReviewRequirementStatus {
  if (!requiresQualitativeCodingReview(datasetProfile)) {
    return "not_required";
  }
  if (review?.status === "approved") {
    return "required_approved";
  }
  return "required_pending";
}
