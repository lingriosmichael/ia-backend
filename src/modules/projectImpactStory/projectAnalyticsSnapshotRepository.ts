import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectAnalyticsSnapshotCreateInput,
  ProjectAnalyticsSnapshotPersistenceRecord,
} from "./projectAnalyticsSnapshotPersistence.js";

export interface ProjectAnalyticsSnapshotRepository {
  create(
    input: ProjectAnalyticsSnapshotCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectAnalyticsSnapshotPersistenceRecord>;
  findLatestByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectAnalyticsSnapshotPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
