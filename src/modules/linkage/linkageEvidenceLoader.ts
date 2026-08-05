import { databaseSession } from "../../shared/database/databaseClient.js";
import type {
  PreparedDatasetColumn,
  PreparedDatasetSnapshot,
} from "../../shared/contracts.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { DatasetPreparationPersistenceRecord } from "../interpretation/datasetPreparationPersistence.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import {
  readRowRecords,
  readTableRecords,
} from "../interpretation/deterministicAnalysisService.js";

export interface LinkageEvidenceLoaderDependencies {
  uploadMetadataRepository: UploadMetadataRepository;
  interpretationResultRepository: InterpretationResultRepository;
  datasetPreparationRepository: DatasetPreparationRepository;
  privacySafeRepresentationRepository: PrivacySafeRepresentationRepository;
}

export interface LinkageEvidenceTable {
  uploadMetadataId: string;
  tableName: string;
  identifierColumn: string | null;
  primaryStatusColumn: string | null;
  positiveStatusValues: string[];
  columns: PreparedDatasetColumn[];
  rows: Record<string, unknown>[];
}

export interface LinkageEvidenceBundle {
  organizationId: string | null;
  projectId: string | null;
  tables: LinkageEvidenceTable[];
}

function isReadyForLinkage(
  preparation: DatasetPreparationPersistenceRecord | undefined,
): preparation is DatasetPreparationPersistenceRecord & {
  preparedDataset: PreparedDatasetSnapshot;
} {
  return (
    preparation !== undefined &&
    preparation.preparedDataset !== null &&
    preparation.preparedDataset.isReadyForDeterministicAnalysis &&
    (preparation.status === "ready_for_analysis" ||
      preparation.status === "analysis_completed")
  );
}

/**
 * Loads every ready, deterministic-analysis-eligible table across an
 * activity's uploads, grouped flat (one entry per table, tagged with its
 * owning upload). Shared by candidate detection (§3) and entity
 * reconciliation (§4/§6) so both operate on identical evidence.
 */
export async function loadLinkageEvidenceTablesForActivity(
  deps: LinkageEvidenceLoaderDependencies,
  activityId: string,
): Promise<LinkageEvidenceBundle> {
  const empty: LinkageEvidenceBundle = {
    organizationId: null,
    projectId: null,
    tables: [],
  };

  const uploads = await deps.uploadMetadataRepository.listByActivityIds(
    [activityId],
    databaseSession,
  );
  if (uploads.length < 2) {
    return empty;
  }

  const results =
    await deps.interpretationResultRepository.findLatestByUploadMetadataIds(
      uploads.map((upload) => upload.id),
      databaseSession,
    );
  if (results.length < 2) {
    return empty;
  }

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

  const tables: LinkageEvidenceTable[] = [];
  for (const result of results) {
    const preparation = preparationByResultId.get(result.id);
    if (!isReadyForLinkage(preparation)) {
      continue;
    }

    const privacySafeRepresentation =
      await deps.privacySafeRepresentationRepository.findById(
        result.privacySafeRepresentationId,
        databaseSession,
      );
    const payloadTablesByName = new Map(
      readTableRecords(privacySafeRepresentation?.payload ?? {}).map(
        (table) => [
          typeof table.name === "string" ? table.name : "table",
          table,
        ],
      ),
    );

    for (const preparedTable of preparation.preparedDataset.tables) {
      const payloadTable = payloadTablesByName.get(preparedTable.name);
      const positiveStatusColumn = preparedTable.columns.find(
        (column) => column.name === preparedTable.primaryStatusColumn,
      );

      tables.push({
        uploadMetadataId: result.uploadMetadataId,
        tableName: preparedTable.name,
        identifierColumn: preparedTable.identifierColumn,
        primaryStatusColumn: preparedTable.primaryStatusColumn,
        positiveStatusValues: positiveStatusColumn?.positiveStatusValues ?? [],
        columns: preparedTable.columns,
        rows: readRowRecords(payloadTable?.rows),
      });
    }
  }

  return {
    organizationId: results[0]?.organizationId ?? null,
    projectId: results[0]?.projectId ?? null,
    tables,
  };
}
