import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ProjectImpactStoryCreateInput,
  ProjectImpactStoryPersistenceRecord,
} from "./projectImpactStoryPersistence.js";

export interface ProjectImpactStoryRepository {
  create(
    input: ProjectImpactStoryCreateInput,
    session: DatabaseSession,
  ): Promise<ProjectImpactStoryPersistenceRecord>;
  findLatestByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ProjectImpactStoryPersistenceRecord | null>;
  // No deleteByActivityId: a story spans every activity in the project, so
  // deleting it because one activity was removed would destroy every other
  // activity's cards too. A single deleted activity makes the story stale
  // on next read instead (see projectImpactStoryStaleness.ts), same as new
  // evidence — only a full project deletion is a real cascade here.
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
