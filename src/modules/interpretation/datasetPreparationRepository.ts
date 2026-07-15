import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  DatasetPreparationPersistenceRecord,
  DatasetPreparationUpsertInput,
} from "./datasetPreparationPersistence.js";

export interface DatasetPreparationRepository {
  upsertByInterpretationResultId(
    input: DatasetPreparationUpsertInput,
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord>;
  findByInterpretationResultId(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord | null>;
  findByInterpretationResultIds(
    interpretationResultIds: string[],
    session: DatabaseSession,
  ): Promise<DatasetPreparationPersistenceRecord[]>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
