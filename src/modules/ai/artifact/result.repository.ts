import type { DatabaseSession } from "../../../shared/database/database-client.js";
import type {
  AIArtifactCreateInput,
  AIArtifactPersistenceRecord,
  AIArtifactUpdateInput,
} from "../persistence/ai-persistence.types.js";

export interface ResultRepository {
  create(
    input: AIArtifactCreateInput,
    session: DatabaseSession,
  ): Promise<AIArtifactPersistenceRecord>;
  listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<AIArtifactPersistenceRecord[]>;
  listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<Array<Pick<
    AIArtifactPersistenceRecord,
    "id" | "activityId" | "status" | "createdAt"
  >>>;
  countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>>;
  countByProjectStatuses(
    projectId: string,
    statuses: AIArtifactPersistenceRecord["status"][],
    session: DatabaseSession,
  ): Promise<number>;
  findById(
    resultRecordId: string,
    session: DatabaseSession,
  ): Promise<AIArtifactPersistenceRecord | null>;
  update(
    resultRecordId: string,
    input: AIArtifactUpdateInput,
    session: DatabaseSession,
  ): Promise<AIArtifactPersistenceRecord>;
}
