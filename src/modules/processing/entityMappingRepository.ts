import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  EntityMappingReplaceContext,
  EntityMappingReplaceEntry,
} from "./entityMappingPersistence.js";

export interface EntityMappingRepository {
  /**
   * Deletes every existing entity mapping for this processing job and
   * inserts the given entries in its place — mirrors the "detect fresh,
   * discard stale" nature of a retried transform, so a job never
   * accumulates mappings from more than one run.
   */
  replaceByProcessingJobId(
    processingJobId: string,
    context: EntityMappingReplaceContext,
    entries: EntityMappingReplaceEntry[],
    session: DatabaseSession,
  ): Promise<void>;
  deleteByProjectId(projectId: string, session: DatabaseSession): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
