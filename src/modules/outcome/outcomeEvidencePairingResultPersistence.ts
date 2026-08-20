import type {
  OutcomeEvidencePairingProposal,
  OutcomeEvidencePairingProposalDecisionRecord,
  OutcomeEvidencePairingReviewStatus,
} from "../../shared/contracts.js";

export interface OutcomeEvidencePairingResultPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  status: OutcomeEvidencePairingReviewStatus;
  proposals: OutcomeEvidencePairingProposal[];
  proposalDecisions: OutcomeEvidencePairingProposalDecisionRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OutcomeEvidencePairingResultUpsertInput {
  organizationId: string;
  projectId: string;
  status: OutcomeEvidencePairingReviewStatus;
  proposals: OutcomeEvidencePairingProposal[];
  proposalDecisions: OutcomeEvidencePairingProposalDecisionRecord[];
}
