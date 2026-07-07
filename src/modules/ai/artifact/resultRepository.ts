import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import type {
  ResultRecordCreateInput,
  ResultRecordPersistenceRecord,
  ResultRecordUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

export interface ResultRepository {
  create(
    input: ResultRecordCreateInput,
    session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord>;
  listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord[]>;
  listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<
    Array<
      Pick<
        ResultRecordPersistenceRecord,
        "id" | "activityId" | "status" | "createdAt"
      >
    >
  >;
  countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>>;
  countByProjectStatuses(
    projectId: string,
    statuses: ResultRecordPersistenceRecord["status"][],
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
  findById(
    resultRecordId: string,
    session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord | null>;
  update(
    resultRecordId: string,
    input: ResultRecordUpdateInput,
    session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord>;
}
