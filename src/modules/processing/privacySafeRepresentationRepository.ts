import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  PrivacySafeRepresentationPersistenceRecord,
  PrivacySafeRepresentationUpsertInput,
} from "./privacySafeRepresentationPersistence.js";

export interface PrivacySafeRepresentationRepository {
  upsertByProcessingJobId(
    input: PrivacySafeRepresentationUpsertInput,
    session: DatabaseSession,
  ): Promise<PrivacySafeRepresentationPersistenceRecord>;
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
