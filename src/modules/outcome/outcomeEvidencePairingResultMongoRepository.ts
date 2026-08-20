import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import type { OutcomeEvidencePairingProposalDecisionRecord } from "../../shared/contracts.js";
import {
  OutcomeEvidencePairingResultMongoModel,
  type OutcomeEvidencePairingResultMongoHydratedDocument,
} from "./outcomeEvidencePairingResultModel.js";
import type { OutcomeEvidencePairingResultRepository } from "./outcomeEvidencePairingResultRepository.js";
import type {
  OutcomeEvidencePairingResultPersistenceRecord,
  OutcomeEvidencePairingResultUpsertInput,
} from "./outcomeEvidencePairingResultPersistence.js";

function toOutcomeEvidencePairingResultRecord(
  document: OutcomeEvidencePairingResultMongoHydratedDocument | null,
): OutcomeEvidencePairingResultPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    status:
      document.status as OutcomeEvidencePairingResultPersistenceRecord["status"],
    proposals: (document.proposals ??
      []) as OutcomeEvidencePairingResultPersistenceRecord["proposals"],
    proposalDecisions: (document.proposalDecisions ??
      []) as OutcomeEvidencePairingResultPersistenceRecord["proposalDecisions"],
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoOutcomeEvidencePairingResultRepository implements OutcomeEvidencePairingResultRepository {
  async upsertByProjectId(
    input: OutcomeEvidencePairingResultUpsertInput,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord> {
    const document = await applyMongoSession(
      OutcomeEvidencePairingResultMongoModel.findOneAndUpdate(
        { projectId: input.projectId },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            status: input.status,
            proposals: input.proposals,
            proposalDecisions: input.proposalDecisions,
          },
        },
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toOutcomeEvidencePairingResultRecord(
      document,
    ) as OutcomeEvidencePairingResultPersistenceRecord;
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      OutcomeEvidencePairingResultMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async findByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      OutcomeEvidencePairingResultMongoModel.findOne({ projectId }),
      session,
    ).exec();
    return toOutcomeEvidencePairingResultRecord(document);
  }

  async upsertProposalDecision(
    projectId: string,
    decision: OutcomeEvidencePairingProposalDecisionRecord,
    session: DatabaseSession,
  ): Promise<OutcomeEvidencePairingResultPersistenceRecord | null> {
    const existingUpdate = await applyMongoSession(
      OutcomeEvidencePairingResultMongoModel.findOneAndUpdate(
        { projectId, "proposalDecisions.proposalId": decision.proposalId },
        {
          $set: {
            "proposalDecisions.$[entry].decision": decision.decision,
            "proposalDecisions.$[entry].outcomeId": decision.outcomeId,
            "proposalDecisions.$[entry].decidedById": decision.decidedById,
            "proposalDecisions.$[entry].decidedAt": decision.decidedAt,
          },
        },
        {
          returnDocument: "after",
          arrayFilters: [{ "entry.proposalId": decision.proposalId }],
        },
      ),
      session,
    ).exec();

    if (existingUpdate) {
      return toOutcomeEvidencePairingResultRecord(existingUpdate);
    }

    const appended = await applyMongoSession(
      OutcomeEvidencePairingResultMongoModel.findOneAndUpdate(
        { projectId },
        { $push: { proposalDecisions: decision } },
        { returnDocument: "after" },
      ),
      session,
    ).exec();
    return toOutcomeEvidencePairingResultRecord(appended);
  }
}
