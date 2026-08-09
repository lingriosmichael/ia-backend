import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivityAnalysisRunV2CreateInput,
  ActivityAnalysisRunV2PersistenceRecord,
} from "./activityAnalysisRunV2Persistence.js";

export interface ActivityAnalysisRunV2Repository {
  create(
    input: ActivityAnalysisRunV2CreateInput,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord>;
  findById(
    analysisRunId: string,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord | null>;
  findLatestByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord | null>;
  listByActivityId(
    activityId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord[]>;
  listByProjectId(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<ActivityAnalysisRunV2PersistenceRecord[]>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
