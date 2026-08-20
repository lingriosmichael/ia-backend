import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { OutcomeEvidencePairingProposalDecisionRecord } from "../../shared/contracts.js";
import type {
  OutcomeEvidencePairingResultPersistenceRecord,
  OutcomeEvidencePairingResultUpsertInput,
} from "./outcomeEvidencePairingResultPersistence.js";

export interface OutcomeEvidencePairingResultRepository {
  upsertByProjectId(
    input: OutcomeEvidencePairingResultUpsertInput,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  findByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord | null>;
  upsertProposalDecision(
    projectId: string,
    decision: OutcomeEvidencePairingProposalDecisionRecord,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord | null>;
}
