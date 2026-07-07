import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ParsedRepresentationPersistenceRecord,
  ParsedRepresentationUpsertInput,
} from "./parsedRepresentationPersistence.js";

export interface ParsedRepresentationRepository {
  upsertByProcessingJobId(
    input: ParsedRepresentationUpsertInput,
    session: DatabaseSession,
  ): Promise<ParsedRepresentationPersistenceRecord>;
  findByProcessingJobId(
    processingJobId: string,
    session: DatabaseSession,
  ): Promise<ParsedRepresentationPersistenceRecord | null>;
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
