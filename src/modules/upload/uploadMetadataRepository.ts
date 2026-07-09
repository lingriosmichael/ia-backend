import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  UploadMetadataCreateInput,
  UploadMetadataPersistenceRecord,
  UploadMetadataUpdateInput,
} from "./uploadMetadataPersistence.js";

export interface UploadMetadataRepository {
  create(
    input: UploadMetadataCreateInput,
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord>;
  listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord[]>;
  listByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord[]>;
  findById(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord | null>;
  listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<
    Array<
      Pick<UploadMetadataPersistenceRecord, "id" | "activityId" | "createdAt">
    >
  >;
  listStorageKeysByProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<string[]>;
  listStorageKeysByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<string[]>;
  countByProject(projectId: string, session: DatabaseSession): Promise<number>;
  countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>>;
  deleteByProject(projectId: string, session: DatabaseSession): Promise<number>;
  deleteByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteById(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord | null>;
  update(
    uploadMetadataId: string,
    input: UploadMetadataUpdateInput,
    session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord>;
}
