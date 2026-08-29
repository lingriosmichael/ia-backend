import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivitySystemType,
  PreparedDatasetColumn,
} from "../../shared/contracts.js";
import type { ActivityRepository } from "../activity/activityRepository.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";

export interface OutcomeEvidencePairingEvidenceLoaderDependencies {
  activityRepository: ActivityRepository;
  uploadMetadataRepository: UploadMetadataRepository;
  interpretationResultRepository: InterpretationResultRepository;
  datasetPreparationRepository: DatasetPreparationRepository;
  privacySafeRepresentationRepository: PrivacySafeRepresentationRepository;
}

export interface OutcomeEvidencePairingEvidenceTable {
  activityId: string;
  activitySystemType: ActivitySystemType | null;
  uploadMetadataId: string;
  tableName: string;
  identifierColumn: string | null;
  columns: PreparedDatasetColumn[];
  hasDuplicateIdentifierValues?: boolean;
  // Observed distinct value count per column name, from the same row scan
  // that produces hasDuplicateIdentifierValues — lets the candidate matcher
  // gate single_distribution eligibility for epistemicRoles that don't
  // already carry Python's own 2-15 distinct-value guarantee (unlike
  // "categorical"), without a second pass over the data.
  columnDistinctValueCounts?: Record<string, number>;
  // Human-declared, from PreparedDatasetTable.cohortTag (the cohort_tag
  // preparation question) — the authoritative cohort/segment signal.
  // Replaces the previous row-content zielgruppe/target_group scrape.
  cohortTag?: string | null;
}

export function isReadyForPairing(
  preparation: DatasetPreparationPersistenceRecord | undefined,
): preparation is DatasetPreparationPersistenceRecord & {
  preparedDataset: NonNullable<
    DatasetPreparationPersistenceRecord["preparedDataset"]
  >;
} {
  return (
    preparation !== undefined &&
    preparation.preparedDataset !== null &&
    preparation.preparedDataset.isReadyForDeterministicAnalysis &&
    (preparation.status === "ready_for_analysis" ||
      preparation.status === "analysis_completed")
  );
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

function normalizeJoinValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
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

export function extractOutcomeEvidenceTableRowMetadata(
  payload: Record<string, unknown>,
  preparedTableName: string,
  identifierColumn: string | null,
  columnNames: string[],
): {
  hasDuplicateIdentifierValues: boolean;
  columnDistinctValueCounts: Record<string, number>;
} {
  const payloadTable = findPayloadTable(payload, preparedTableName);
  if (!payloadTable) {
    return {
      hasDuplicateIdentifierValues: false,
      columnDistinctValueCounts: {},
    };
  }

  const rows = readRecordArray(payloadTable.rows);
  if (rows.length === 0) {
    return {
      hasDuplicateIdentifierValues: false,
      columnDistinctValueCounts: {},
    };
  }

  const distinctIdentifierValues = new Set<string>();
  let identifierValueCount = 0;
  const distinctValuesByColumn = new Map<string, Set<string>>(
    columnNames.map((columnName) => [columnName, new Set<string>()]),
  );

  for (const row of rows) {
    if (identifierColumn) {
      const identifierValue = normalizeJoinValue(row[identifierColumn]);
      if (identifierValue) {
        identifierValueCount += 1;
        distinctIdentifierValues.add(identifierValue);
      }
    }
    for (const [columnName, distinctValues] of distinctValuesByColumn) {
      const value = normalizeJoinValue(row[columnName]);
      if (value !== null) {
        distinctValues.add(value);
      }
    }
  }

  const columnDistinctValueCounts: Record<string, number> = {};
  for (const [columnName, distinctValues] of distinctValuesByColumn) {
    columnDistinctValueCounts[columnName] = distinctValues.size;
  }

  return {
    // A duplicate-keyed identifier column can never safely drive a
    // row-level join (see executeJoinTables's fan-out behavior) — this is
    // only meaningful when we actually observed identifier values at all.
    hasDuplicateIdentifierValues:
      identifierValueCount > 0 &&
      identifierValueCount > distinctIdentifierValues.size,
    columnDistinctValueCounts,
  };
}

/**
 * Table-loading core for the exploratory story-chart pairing lane (every
 * activity in the project — see loadProjectEvidenceTablesForStoryPairing).
 * Parameterized by an activity-scope predicate for historical reasons (it
 * used to also serve the outcome-evidence-pairing flow's system-activity-
 * only scope, removed in OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 6 in favor of
 * outcomeEvidenceCandidateCatalogBuilder.ts's single-activity loader) — kept
 * as a parameter rather than inlined since it costs nothing and documents
 * the one real scope decision this function makes.
 */
async function loadEvidenceTablesForPairing(
  deps: OutcomeEvidencePairingEvidenceLoaderDependencies,
  projectId: string,
  isActivityInScope: (systemType: ActivitySystemType | null) => boolean,
): Promise<OutcomeEvidencePairingEvidenceTable[]> {
  const activities = await deps.activityRepository.listByProject(
    projectId,
    databaseSession,
  );
  const scopedActivities = activities.filter((activity) =>
    isActivityInScope(activity.systemType),
  );
  if (scopedActivities.length === 0) {
    return [];
  }

  const uploads = await deps.uploadMetadataRepository.listByActivityIds(
    scopedActivities.map((activity) => activity.id),
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

  const activityIdByUploadMetadataId = new Map(
    uploads.map((upload) => [upload.id, upload.activityId]),
  );
  const systemTypeByActivityId = new Map(
    scopedActivities.map((activity) => [activity.id, activity.systemType]),
  );

  const preparations =
    await deps.datasetPreparationRepository.findByInterpretationResultIds(
      results.map((result) => result.id),
      databaseSession,
    );
  const preparationByResultId = new Map(
    preparations.map((preparation) => [
      preparation.interpretationResultId,
      preparation,
    ]),
  );

  const tables: OutcomeEvidencePairingEvidenceTable[] = [];
  for (const result of results) {
    const activityId = activityIdByUploadMetadataId.get(
      result.uploadMetadataId,
    );
    const preparation = preparationByResultId.get(result.id);
    if (!activityId || !isReadyForPairing(preparation)) {
      continue;
    }

    for (const preparedTable of preparation.preparedDataset.tables) {
      const rowMetadata = extractOutcomeEvidenceTableRowMetadata(
        privacySafeRepresentationByUploadId.get(result.uploadMetadataId)
          ?.payload ?? {},
        preparedTable.name,
        preparedTable.identifierColumn,
        preparedTable.columns.map((column) => column.name),
      );
      tables.push({
        activityId,
        activitySystemType: systemTypeByActivityId.get(activityId) ?? null,
        uploadMetadataId: result.uploadMetadataId,
        tableName: preparedTable.name,
        identifierColumn: preparedTable.identifierColumn,
        columns: preparedTable.columns,
        hasDuplicateIdentifierValues: rowMetadata.hasDuplicateIdentifierValues,
        columnDistinctValueCounts: rowMetadata.columnDistinctValueCounts,
        cohortTag: preparedTable.cohortTag ?? null,
      });
    }
  }

  return tables;
}

/**
 * Loads every ready, deterministic-analysis-eligible table across *every*
 * activity in the project — needed for the exploratory paired-story-delta
 * chart lane (projectImpactStoryPairedStoryDeltaCatalog.ts), where the
 * target case is a single ordinary activity's own before/after columns
 * (e.g. one workshop's own pre/post feedback form). That lane's own
 * declared-pairing detection was removed in Phase 6 (see that file's doc
 * comment), so this loader's result is currently unused there too, but the
 * loader itself makes no assumption about that — it's a generic
 * every-activity table load, kept for whatever that lane becomes next.
 */
export async function loadProjectEvidenceTablesForStoryPairing(
  deps: OutcomeEvidencePairingEvidenceLoaderDependencies,
  projectId: string,
): Promise<OutcomeEvidencePairingEvidenceTable[]> {
  return loadEvidenceTablesForPairing(deps, projectId, () => true);
}
