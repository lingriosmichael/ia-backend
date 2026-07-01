import type { DatabaseSession } from "../../shared/database/database-client.js";
import type {
  ActivityCreateInput,
  ActivityPersistenceRecord,
  ActivityUpdateInput,
} from "./activity.persistence.js";

export interface ActivityRepository {
  slugExists(projectId: string, slug: string, session: DatabaseSession): Promise<boolean>;
  create(
    input: ActivityCreateInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord>;
  findById(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null>;
  update(
    activityId: string,
    input: ActivityUpdateInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord>;
  listByProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]>;
  listByProjectIds(
    projectIds: string[],
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]>;
}
