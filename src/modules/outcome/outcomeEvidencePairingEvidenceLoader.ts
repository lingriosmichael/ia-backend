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
  // Human-declared, from PreparedDatasetTable.cohortTag (the cohort_tag
  // preparation question) — the authoritative cohort/segment signal.
  // Replaces the previous row-content zielgruppe/target_group scrape.
  cohortTag?: string | null;
}

function isOutcomeEvidenceSystemActivity(
  systemType: ActivitySystemType | null,
): boolean {
  return systemType === "baseline" || systemType === "impact_measurement";
}

function isReadyForPairing(
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

export function extractOutcomeEvidenceIdentifierMetadata(
  payload: Record<string, unknown>,
  preparedTableName: string,
  identifierColumn: string | null,
): {
  hasDuplicateIdentifierValues: boolean;
} {
  const payloadTable = findPayloadTable(payload, preparedTableName);
  if (!payloadTable) {
    return { hasDuplicateIdentifierValues: false };
  }

  const rows = readRecordArray(payloadTable.rows);
  if (rows.length === 0) {
    return { hasDuplicateIdentifierValues: false };
  }

  const distinctIdentifierValues = new Set<string>();
  let identifierValueCount = 0;
  for (const row of rows) {
    if (identifierColumn) {
      const identifierValue = normalizeJoinValue(row[identifierColumn]);
      if (identifierValue) {
        identifierValueCount += 1;
        distinctIdentifierValues.add(identifierValue);
      }
    }
  }

  return {
    // A duplicate-keyed identifier column can never safely drive a
    // row-level join (see executeJoinTables's fan-out behavior) — this is
    // only meaningful when we actually observed identifier values at all.
    hasDuplicateIdentifierValues:
      identifierValueCount > 0 &&
      identifierValueCount > distinctIdentifierValues.size,
  };
}

/**
 * Shared table-loading core for both outcome-evidence pairing (system
 * activities only — see loadProjectEvidenceTablesForOutcomePairing) and
 * the exploratory story-chart pairing lane (every activity — see
 * loadProjectEvidenceTablesForStoryPairing), parameterized by which
 * activities are in scope. Both callers hand the *same* declared-pairing
 * candidates (computeOutcomeEvidencePairingCandidates) whatever tables
 * this returns; only the activity scope differs, never the pairing logic
 * itself.
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
      const identifierMetadata = extractOutcomeEvidenceIdentifierMetadata(
        privacySafeRepresentationByUploadId.get(result.uploadMetadataId)
          ?.payload ?? {},
        preparedTable.name,
        preparedTable.identifierColumn,
      );
      tables.push({
        activityId,
        activitySystemType: systemTypeByActivityId.get(activityId) ?? null,
        uploadMetadataId: result.uploadMetadataId,
        tableName: preparedTable.name,
        identifierColumn: preparedTable.identifierColumn,
        columns: preparedTable.columns,
        hasDuplicateIdentifierValues:
          identifierMetadata.hasDuplicateIdentifierValues,
        cohortTag: preparedTable.cohortTag ?? null,
      });
    }
  }

  return tables;
}

/**
 * Loads every ready, deterministic-analysis-eligible table across an
 * entire project's *system* activities only (baseline/impact_measurement)
 * — deliberately project-scoped, not per-activity like
 * linkageEvidenceLoader.ts, because a before/after outcome pair spans two
 * different system activities (see IMPACT_STORY_OUTCOME_EXTENSION_PLAN.md
 * §4.1). Feeds confirmed OutcomeEvidenceLink pairing proposals — see
 * loadProjectEvidenceTablesForStoryPairing for the broader, all-activities
 * variant used by the exploratory story-chart lane.
 */
export async function loadProjectEvidenceTablesForOutcomePairing(
  deps: OutcomeEvidencePairingEvidenceLoaderDependencies,
  projectId: string,
): Promise<OutcomeEvidencePairingEvidenceTable[]> {
  return loadEvidenceTablesForPairing(
    deps,
    projectId,
    isOutcomeEvidenceSystemActivity,
  );
}

/**
 * Same table-loading core as loadProjectEvidenceTablesForOutcomePairing,
 * but scoped to *every* activity in the project, not just the two system
 * activities — needed for the exploratory paired-story-delta chart lane,
 * where the target case is a single ordinary activity's own before/after
 * columns (e.g. one workshop's own pre/post feedback form), which
 * loadProjectEvidenceTablesForOutcomePairing's system-activity-only scope
 * would never see. Declared-pairing detection itself
 * (computeOutcomeEvidencePairingCandidates) is unchanged and unaware of
 * systemType either way — only which tables reach it differs.
 */
export async function loadProjectEvidenceTablesForStoryPairing(
  deps: OutcomeEvidencePairingEvidenceLoaderDependencies,
  projectId: string,
): Promise<OutcomeEvidencePairingEvidenceTable[]> {
  return loadEvidenceTablesForPairing(deps, projectId, () => true);
}
