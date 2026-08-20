import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  OutcomeEvidenceLinkCreateInput,
  OutcomeEvidenceLinkPersistenceRecord,
} from "./outcomeEvidenceLinkPersistence.js";

export interface OutcomeEvidenceLinkRepository {
  create(
    input: OutcomeEvidenceLinkCreateInput,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number>;
  findById(
    linkId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord | null>;
  listByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidenceLinkPersistenceRecord[]>;
  deleteById(linkId: string, session: DatabaseSession): Promise<boolean>;
}
