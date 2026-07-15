import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  DeterministicAnalysisPersistenceRecord,
  DeterministicAnalysisUpsertInput,
} from "./deterministicAnalysisPersistence.js";

export interface DeterministicAnalysisRepository {
  upsertByInterpretationResultId(
    input: DeterministicAnalysisUpsertInput,
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord>;
  findByInterpretationResultId(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord | null>;
  findByInterpretationResultIds(
    interpretationResultIds: string[],
    session: DatabaseSession,
  ): Promise<DeterministicAnalysisPersistenceRecord[]>;
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
}
