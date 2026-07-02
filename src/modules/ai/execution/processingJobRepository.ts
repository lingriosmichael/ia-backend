import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import type {
  AIExecutionCreateInput,
  AIExecutionPersistenceRecord,
  AIExecutionUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

export interface ProcessingJobRepository {
  create(
    input: AIExecutionCreateInput,
    session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord>;
  listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord[]>;
  listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<Array<Pick<
    AIExecutionPersistenceRecord,
    "id" | "activityId" | "status" | "createdAt"
  >>>;
  countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>>;
  countByProjectStatuses(
    projectId: string,
    statuses: AIExecutionPersistenceRecord["status"][],
    session: DatabaseSession,
  ): Promise<number>;
  findById(
    processingJobId: string,
    session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord | null>;
  update(
    processingJobId: string,
    input: AIExecutionUpdateInput,
    session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord>;
}
