import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { InterpretationIndicatorStatus } from "../../shared/contracts.js";
import type {
  InterpretationQuestionAnswerInput,
  InterpretationResultCreateInput,
  InterpretationResultPersistenceRecord,
} from "./interpretationResultPersistence.js";

export interface InterpretationResultRepository {
  create(
    input: InterpretationResultCreateInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord>;
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
   * Atomically answers a question only if it is still "pending". Returns
   * null if the result or question was not found, or the question had
   * already been answered (e.g. a concurrent submission) — the caller
   * decides which error that maps to.
   */
  answerQuestionIfPending(
    interpretationResultId: string,
    questionId: string,
    input: InterpretationQuestionAnswerInput,
    session: DatabaseSession,
  ): Promise<InterpretationResultPersistenceRecord | null>;
  /**
   * Sets an indicator's kept/rejected status. Freely toggleable in either
   * direction — unlike question answers, there's no "already decided" lock,
   * since curating which indicators represent the activity's real outcome
   * is expected to be revised as often as the user likes.
   */
  setIndicatorStatus(
    interpretationResultId: string,
    indicatorId: string,
    status: InterpretationIndicatorStatus,
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
