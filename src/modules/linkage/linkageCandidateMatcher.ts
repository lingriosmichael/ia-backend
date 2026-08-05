import type { PreparedDatasetColumn } from "../../shared/contracts.js";
import type { LinkageEvidenceTable } from "./linkageEvidenceLoader.js";

const MIN_JACCARD_OVERLAP_RATIO = 0.6;
// Guards against coincidental matches between small or low-cardinality
// columns (e.g. two unrelated boolean-ish fields overlapping trivially).
const MIN_CANDIDATE_COLUMN_DISTINCT_VALUES = 3;
const MIN_CANDIDATE_COLUMN_INTERSECTION_SIZE = 3;

const NAME_LIKE_COLUMN_ROLES: ReadonlySet<PreparedDatasetColumn["role"]> =
  new Set(["free_text", "subgroup", "other"]);

export type LinkageCandidateMatchBasis =
  "identifier_column" | "name_like_column";
export type LinkageCandidateConfidence = "high" | "medium";

export interface LinkageCandidateColumnReference {
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
}

export interface LinkageCandidate {
  uploadMetadataIdA: string;
  uploadMetadataIdB: string;
  columnA: LinkageCandidateColumnReference;
  columnB: LinkageCandidateColumnReference;
  matchBasis: LinkageCandidateMatchBasis;
  confidence: LinkageCandidateConfidence;
  overlapRatio: number;
}

interface LinkableColumn {
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
  isIdentifier: boolean;
  distinctValues: Set<string>;
}

interface LinkableUpload {
  uploadMetadataId: string;
  columns: LinkableColumn[];
}

interface ColumnPairMatch {
  columnA: LinkableColumn;
  columnB: LinkableColumn;
  overlapRatio: number;
}

export function normalizeLinkageValue(value: unknown): string | null {
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

  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function jaccardOverlapRatio(
  valuesA: Set<string>,
  valuesB: Set<string>,
): { ratio: number; intersectionSize: number } {
  if (valuesA.size === 0 || valuesB.size === 0) {
    return { ratio: 0, intersectionSize: 0 };
  }

  let intersectionSize = 0;
  for (const value of valuesA) {
    if (valuesB.has(value)) {
      intersectionSize += 1;
    }
  }

  const unionSize = valuesA.size + valuesB.size - intersectionSize;
  return {
    ratio: unionSize === 0 ? 0 : intersectionSize / unionSize,
    intersectionSize,
  };
}

function buildLinkableColumnsForTable(
  table: LinkageEvidenceTable,
): LinkableColumn[] {
  const candidateColumns = table.columns.filter(
    (column) =>
      column.role === "identifier" || NAME_LIKE_COLUMN_ROLES.has(column.role),
  );

  return candidateColumns
    .map((column) => {
      const distinctValues = new Set<string>();
      for (const row of table.rows) {
        const normalized = normalizeLinkageValue(row[column.name]);
        if (normalized !== null) {
          distinctValues.add(normalized);
        }
      }

      return {
        uploadMetadataId: table.uploadMetadataId,
        tableName: table.tableName,
        columnName: column.name,
        isIdentifier: column.role === "identifier",
        distinctValues,
      };
    })
    .filter(
      (column) =>
        column.distinctValues.size >= MIN_CANDIDATE_COLUMN_DISTINCT_VALUES,
    );
}

function groupLinkableColumnsByUpload(
  tables: LinkageEvidenceTable[],
): LinkableUpload[] {
  const columnsByUploadId = new Map<string, LinkableColumn[]>();
  for (const table of tables) {
    const columns = buildLinkableColumnsForTable(table);
    const existing = columnsByUploadId.get(table.uploadMetadataId) ?? [];
    columnsByUploadId.set(table.uploadMetadataId, [...existing, ...columns]);
  }

  return Array.from(columnsByUploadId.entries()).map(
    ([uploadMetadataId, columns]) => ({ uploadMetadataId, columns }),
  );
}

function findBestColumnPairMatch(
  columnsA: LinkableColumn[],
  columnsB: LinkableColumn[],
): ColumnPairMatch | null {
  let best: ColumnPairMatch | null = null;

  for (const columnA of columnsA) {
    for (const columnB of columnsB) {
      const { ratio, intersectionSize } = jaccardOverlapRatio(
        columnA.distinctValues,
        columnB.distinctValues,
      );
      if (
        ratio < MIN_JACCARD_OVERLAP_RATIO ||
        intersectionSize < MIN_CANDIDATE_COLUMN_INTERSECTION_SIZE
      ) {
        continue;
      }
      if (!best || ratio > best.overlapRatio) {
        best = { columnA, columnB, overlapRatio: ratio };
      }
    }
  }

  return best;
}

function toLinkageCandidate(
  match: ColumnPairMatch,
  matchBasis: LinkageCandidateMatchBasis,
  confidence: LinkageCandidateConfidence,
): LinkageCandidate {
  return {
    uploadMetadataIdA: match.columnA.uploadMetadataId,
    uploadMetadataIdB: match.columnB.uploadMetadataId,
    columnA: {
      uploadMetadataId: match.columnA.uploadMetadataId,
      tableName: match.columnA.tableName,
      columnName: match.columnA.columnName,
    },
    columnB: {
      uploadMetadataId: match.columnB.uploadMetadataId,
      tableName: match.columnB.tableName,
      columnName: match.columnB.columnName,
    },
    matchBasis,
    confidence,
    overlapRatio: match.overlapRatio,
  };
}

// Identifier-column matches are preferred; name-like columns are only
// considered as a fallback, per design §3-4.
function findBestLinkageCandidate(
  uploadA: LinkableUpload,
  uploadB: LinkableUpload,
): LinkageCandidate | null {
  const identifierMatch = findBestColumnPairMatch(
    uploadA.columns.filter((column) => column.isIdentifier),
    uploadB.columns.filter((column) => column.isIdentifier),
  );

  if (identifierMatch) {
    return toLinkageCandidate(identifierMatch, "identifier_column", "high");
  }

  const nameLikeMatch = findBestColumnPairMatch(
    uploadA.columns.filter((column) => !column.isIdentifier),
    uploadB.columns.filter((column) => !column.isIdentifier),
  );

  if (nameLikeMatch) {
    return toLinkageCandidate(nameLikeMatch, "name_like_column", "medium");
  }

  return null;
}

/**
 * Pure computation (no I/O): proposes one join-key candidate per upload
 * pair by comparing identifier/name-like column value overlap (§3-4).
 */
export function computeLinkageCandidates(
  tables: LinkageEvidenceTable[],
): LinkageCandidate[] {
  const linkableUploads = groupLinkableColumnsByUpload(tables);
  if (linkableUploads.length < 2) {
    return [];
  }

  const candidates: LinkageCandidate[] = [];
  for (const [i, uploadA] of linkableUploads.entries()) {
    for (const uploadB of linkableUploads.slice(i + 1)) {
      const candidate = findBestLinkageCandidate(uploadA, uploadB);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}
