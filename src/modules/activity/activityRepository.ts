import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
  ActivityCreateInput,
  ActivityLlmTokenLedgerIncrement,
  ActivityPersistenceRecord,
  SystemActivityEnsureInput,
  ActivityUpdateInput,
} from "./activityPersistence.js";

export interface ActivityRepository {
  create(
    input: ActivityCreateInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord>;
  ensureSystemActivity(
    input: SystemActivityEnsureInput,
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
  /**
   * Atomically replaces the clarification answer for `answer.questionId`
   * (or appends it if none exists yet) without reading and rewriting the
   * whole answers array. Concurrent calls for different question ids must
   * not be able to clobber each other's answers.
   */
  upsertClarificationAnswer(
    activityId: string,
    answer: ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord>;
  incrementLlmTokenLedger(
    activityId: string,
    increment: ActivityLlmTokenLedgerIncrement,
    session: DatabaseSession,
  ): Promise<void>;
  listByProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]>;
  listByProjectIds(
    projectIds: string[],
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]>;
  deleteByProject(projectId: string, session: DatabaseSession): Promise<number>;
  deleteById(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null>;
}
