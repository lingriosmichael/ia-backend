import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  InterpretationQuestionAnswerInput,
  InterpretationResultCreateInput,
  InterpretationResultPersistenceRecord,
  InterpretationResultSynthesisUpdateInput,
} from "./interpretationResultPersistence.js";

export interface InterpretationResultRepository {
  create(
    input: InterpretationResultCreateInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord>;
  replaceSynthesisArtifacts(
    interpretationResultId: string,
    input: InterpretationResultSynthesisUpdateInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null>;
  findById(
    interpretationResultId: string,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null>;
  findLatestByPrivacySafeRepresentationId(
    privacySafeRepresentationId: string,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null>;
  /**
   * One result per uploadMetadataId — the most recently created
   * interpretation for each uploaded file. Each upload is interpreted and
   * displayed independently, so this deliberately does NOT collapse across
   * an activity's multiple uploaded files the way a naive "one per
   * activity" query would.
   */
  findLatestByUploadMetadataIds(
    uploadMetadataIds: string[],
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord[]>;
  /**
   * Creates or updates a question answer by question id. Returns null if
   * the result or question was not found.
   */
  answerQuestion(
    interpretationResultId: string,
    questionId: string,
    input: InterpretationQuestionAnswerInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null>;
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
