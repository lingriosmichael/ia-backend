import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivityEvidenceLinkageResultPersistenceRecord,
  ActivityEvidenceLinkageResultUpsertInput,
} from "./activityEvidenceLinkageResultPersistence.js";

export interface ActivityEvidenceLinkageResultRepository {
  upsertByActivityId(
    input: ActivityEvidenceLinkageResultUpsertInput,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord>;
  findByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
