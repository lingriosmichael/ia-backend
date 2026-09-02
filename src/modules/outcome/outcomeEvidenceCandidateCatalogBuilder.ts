import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetProfileColumnType,
  EpistemicRole,
  PreparedDatasetColumn,
  UploadDatasetRole,
} from "../../shared/contracts.js";
import { humanizeColumnName } from "../interpretation/activityAnalysisV2Service.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import {
  augmentPrivacySafePayloadWithApprovedQualitativeCodingReview,
  extractApprovedSubjectiveCodeColumnProvenance,
  extractSyntheticQualitativeCodeColumnMetadata,
  preparedDatasetTableWithSyntheticColumns,
} from "../processing/qualitativeCodingReviewSupport.js";
import {
  extractOutcomeEvidenceTableRowMetadata,
  isReadyForPairing,
} from "./outcomeEvidencePairingEvidenceLoader.js";

export interface OutcomeEvidenceCandidateCatalogDependencies {
  uploadMetadataRepository: UploadMetadataRepository;
  interpretationResultRepository: InterpretationResultRepository;
  datasetPreparationRepository: DatasetPreparationRepository;
  privacySafeRepresentationRepository: PrivacySafeRepresentationRepository;
  qualitativeCodingReviewRepository: QualitativeCodingReviewRepository;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function findPayloadTable(
  payload: Record<string, unknown>,
  preparedTableName: string,
): Record<string, unknown> | null {
  const tables = readRecordArray(payload.tables);
  if (tables.length === 0) {
    return null;
  }

  const exactMatch =
    tables.find((table) => readString(table.name) === preparedTableName) ??
    null;
  if (exactMatch) {
    return exactMatch;
  }

  return tables.length === 1 ? (tables[0] ?? null) : null;
}

export interface OutcomeEvidenceSubjectiveCodeProvenance {
  findingKey: string;
  textColumnName: string;
  sourceCodebookFrom: {
    uploadMetadataId: string;
    findingKey: string;
  } | null;
}

// The only structural exclusion, per OUTCOME_EVIDENCE_MERGE_PLAN.md §4.3:
// "identifier" is the row/participant join key, never evidence itself, and
// "free_text" is raw open-ended qualitative data with no coding/grouping
// step yet (the old, now-deleted candidate matcher excluded it for the same
// reason). Deliberately narrower
// than the old candidate matcher's eligibility gate — no validated_scale
// requirement, no declared-pairing-tag requirement, and a column with no
// resolved epistemicRole yet is still offered as a candidate rather than
// silently dropped, since the recommendation call (§4.3) is a holistic LLM
// judgment, not a deterministic per-column rule.
const CANDIDATE_CATALOG_EXCLUDED_EPISTEMIC_ROLES = new Set<EpistemicRole>([
  "identifier",
  "free_text",
]);

// What ia_backend sends Python instead of raw column/table identifiers (the
// request also sends a humanized label, but never the raw
// uploadMetadataId/tableName/columnName themselves), and what a
// recommendation response references back — resolved against the same
// catalog this same request already built, all within
// OutcomeEvidenceRecommendationService's single request/response cycle
// (never persisted, never re-derived independently later, so there's no
// need for this to be a pure function of the column's identifying fields).
//
// Deliberately just a short position marker like "col_3", not a compound of
// the real identifiers (uploadMetadataId/tableName/columnName joined
// together) the way this used to work: that embedded the column's full,
// human-language name — including punctuation like "(1-5)" — directly in
// the string the model had to copy back byte-for-byte. In production, the
// model reliably "tidied up" that punctuation when copying it (e.g.
// "(1-5)" back as "(1 5)"), which failed the exact-string grounding check
// in recommendation_grounding.py on effectively every recommendation,
// silently producing zero results. A short, content-free token has nothing
// for the model to normalize.
export function buildOutcomeEvidenceCatalogColumnId(index: number): string {
  return `col_${index}`;
}

export interface OutcomeEvidenceCandidateCatalogEntry {
  columnId: string;
  uploadMetadataId: string;
  tableName: string;
  columnName: string;
  label: string;
  epistemicRole: EpistemicRole | null;
  inferredType: DatasetProfileColumnType | null;
  // Observed distinct-value count for this column, from the same
  // privacy-safe-representation row scan outcomeEvidencePairingEvidenceLoader.ts
  // already performs — null only when no row data was available to scan.
  distinctValueCount: number | null;
  // The table's declared identifier column (not this column's own role) —
  // carried through so a later step can resolve/verify the join key without
  // a second lookup.
  identifierColumn: string | null;
  // The table's declared cohortTag (see cohort_tag preparation question) —
  // null for the common case of a project with a single, untagged cohort.
  cohortTag: string | null;
  // The source upload's human-set baseline/follow-up classification (never
  // inferred from filename — see OUTCOME_EVIDENCE_MERGE_PLAN.md's pre/post
  // inversion fix). Null means unclassified; outcomeEvidenceRecommendationService.ts
  // uses this, not anything the LLM proposes, to decide which side of a
  // paired recommendation is "before" and which is "after".
  datasetRole: UploadDatasetRole | null;
}

// A single merged activity's table, re-shaped for outcome-evidence use —
// the single-activity equivalent of outcomeEvidencePairingEvidenceLoader.ts's
// OutcomeEvidencePairingEvidenceTable (which additionally carries
// activityId/activitySystemType, meaningless here since the caller already
// knows the one activityId it asked for). Exported so both the candidate
// catalog below (LLM-facing, column-level, no hasDuplicateIdentifierValues)
// and the approval-time safety check (OUTCOME_EVIDENCE_MERGE_PLAN.md §4.4
// step 2, table-level, needs hasDuplicateIdentifierValues) load from the
// same single query path instead of two drifting copies of it.
export interface OutcomeEvidenceActivityTable {
  uploadMetadataId: string;
  tableName: string;
  identifierColumn: string | null;
  hasDuplicateIdentifierValues: boolean;
  cohortTag: string | null;
  datasetRole: UploadDatasetRole | null;
  columns: PreparedDatasetColumn[];
  columnDistinctValueCounts: Record<string, number>;
  subjectiveCodeProvenanceByColumnName: Record<
    string,
    OutcomeEvidenceSubjectiveCodeProvenance
  >;
}

export async function loadOutcomeEvidenceActivityTables(
  deps: OutcomeEvidenceCandidateCatalogDependencies,
  activityId: string,
): Promise<OutcomeEvidenceActivityTable[]> {
  const uploads = await deps.uploadMetadataRepository.listByActivity(
    activityId,
    databaseSession,
  );
  if (uploads.length === 0) {
    return [];
  }

  const results =
    await deps.interpretationResultRepository.findLatestByUploadMetadataIds(
      uploads.map((upload) => upload.id),
      databaseSession,
    );
  if (results.length === 0) {
    return [];
  }

  const privacySafeRepresentations =
    await deps.privacySafeRepresentationRepository.findLatestByUploadMetadataIds(
      uploads.map((upload) => upload.id),
      databaseSession,
    );
  const privacySafeRepresentationByUploadId = new Map(
    privacySafeRepresentations.map((representation) => [
      representation.uploadMetadataId,
      representation,
    ]),
  );

  const preparations =
    await deps.datasetPreparationRepository.findByInterpretationResultIds(
      results.map((result) => result.id),
      databaseSession,
    );
  const qualitativeCodingReviews =
    await deps.qualitativeCodingReviewRepository.findByUploadMetadataIds(
      uploads.map((upload) => upload.id),
      databaseSession,
    );
  const preparationByResultId = new Map(
    preparations.map((preparation) => [
      preparation.interpretationResultId,
      preparation,
    ]),
  );
  const qualitativeCodingReviewByUploadId = new Map(
    qualitativeCodingReviews.map((review) => [review.uploadMetadataId, review]),
  );
  const datasetRoleByUploadId = new Map(
    uploads.map((upload) => [upload.id, upload.datasetRole]),
  );

  const tables: OutcomeEvidenceActivityTable[] = [];
  for (const result of results) {
    const preparation = preparationByResultId.get(result.id);
    if (!isReadyForPairing(preparation)) {
      continue;
    }

    const qualitativeCodingReview =
      qualitativeCodingReviewByUploadId.get(result.uploadMetadataId) ?? null;
    const augmentedPayload =
      augmentPrivacySafePayloadWithApprovedQualitativeCodingReview(
        privacySafeRepresentationByUploadId.get(result.uploadMetadataId)
          ?.payload ?? {},
        qualitativeCodingReview,
      );
    const subjectiveCodeProvenance =
      extractApprovedSubjectiveCodeColumnProvenance(qualitativeCodingReview);

    for (const preparedTable of preparation.preparedDataset.tables) {
      const payloadTable = findPayloadTable(
        augmentedPayload,
        preparedTable.name,
      );
      const syntheticColumns = payloadTable
        ? extractSyntheticQualitativeCodeColumnMetadata(payloadTable)
        : [];
      const preparedTableWithSyntheticColumns =
        preparedDatasetTableWithSyntheticColumns(
          preparedTable,
          syntheticColumns,
        ) ?? preparedTable;
      const rowMetadata = extractOutcomeEvidenceTableRowMetadata(
        augmentedPayload,
        preparedTableWithSyntheticColumns.name,
        preparedTableWithSyntheticColumns.identifierColumn,
        preparedTableWithSyntheticColumns.columns.map((column) => column.name),
      );
      const subjectiveCodeProvenanceByColumnName = Object.fromEntries(
        subjectiveCodeProvenance
          .filter((entry) => entry.tableName === preparedTable.name)
          .map((entry) => [
            entry.syntheticCodeColumnName,
            {
              findingKey: entry.findingKey,
              textColumnName: entry.textColumnName,
              sourceCodebookFrom: entry.sourceCodebookFrom,
            } satisfies OutcomeEvidenceSubjectiveCodeProvenance,
          ]),
      );

      tables.push({
        uploadMetadataId: result.uploadMetadataId,
        tableName: preparedTableWithSyntheticColumns.name,
        identifierColumn: preparedTableWithSyntheticColumns.identifierColumn,
        hasDuplicateIdentifierValues: rowMetadata.hasDuplicateIdentifierValues,
        cohortTag: preparedTableWithSyntheticColumns.cohortTag ?? null,
        datasetRole: datasetRoleByUploadId.get(result.uploadMetadataId) ?? null,
        columns: preparedTableWithSyntheticColumns.columns,
        columnDistinctValueCounts: rowMetadata.columnDistinctValueCounts,
        subjectiveCodeProvenanceByColumnName,
      });
    }
  }

  return tables;
}

/**
 * Builds the flat candidate catalog the new joint pairing+outcome
 * recommendation call (OUTCOME_EVIDENCE_MERGE_PLAN.md §4.3) is given, for
 * one merged "Ausgangslage & Wirkungsdaten" activity. Scoped to a single
 * already-known activityId — the project-wide scan across two separate
 * system-typed activities that the old (deleted) pairing flow needed no
 * longer applies now that baseline/impact_measurement are merged into one.
 */
export async function buildOutcomeEvidenceCandidateCatalog(
  deps: OutcomeEvidenceCandidateCatalogDependencies,
  activityId: string,
): Promise<OutcomeEvidenceCandidateCatalogEntry[]> {
  const tables = await loadOutcomeEvidenceActivityTables(deps, activityId);

  const catalog: OutcomeEvidenceCandidateCatalogEntry[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (
        column.epistemicRole !== null &&
        CANDIDATE_CATALOG_EXCLUDED_EPISTEMIC_ROLES.has(column.epistemicRole)
      ) {
        continue;
      }

      catalog.push({
        columnId: buildOutcomeEvidenceCatalogColumnId(catalog.length + 1),
        uploadMetadataId: table.uploadMetadataId,
        tableName: table.tableName,
        columnName: column.name,
        label: humanizeColumnName(column.name),
        epistemicRole: column.epistemicRole,
        inferredType: column.inferredType,
        distinctValueCount:
          table.columnDistinctValueCounts[column.name] ?? null,
        identifierColumn: table.identifierColumn,
        cohortTag: table.cohortTag,
        datasetRole: table.datasetRole,
      });
    }
  }

  return catalog;
}
