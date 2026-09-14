import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  InterpretationQuestionBatchAnswerInput,
  InterpretationResultCreateInput,
  InterpretationResultPersistenceRecord,
  InterpretationResultSynthesisFailureInput,
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
  /**
   * Records that a synthesis attempt (quantitative-only or mixed) failed,
   * without touching any existing entities/indicators/etc — so a failed
   * attempt is visibly distinct from "never attempted" instead of leaving
   * the result silently unchanged (see InterpretationResultSynthesisStatus).
   */
  recordSynthesisFailure(
    interpretationResultId: string,
    input: InterpretationResultSynthesisFailureInput,
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
   * Every InterpretationResult ever created for the project — every
   * version, every upload, not collapsed to "latest per upload" the way
   * findLatestByUploadMetadataIds is. Each version's own LLM calls already
   * happened and cost money, so a cost/usage rollup needs all of them, not
   * just the current one.
   */
  findAllByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord[]>;
  /**
   * Answers one or more questions on a single InterpretationResult in one
   * atomic update — every answer in `answers` is a $set on the same
   * document, so this either applies all of them or none of them; a
   * caller must never assume a partial batch can be persisted. Returns
   * null if the result was not found.
   */
  answerQuestions(
    interpretationResultId: string,
    answers: InterpretationQuestionBatchAnswerInput[],
    answeredById: string,
    answeredAt: Date,
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
