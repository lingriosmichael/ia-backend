import type {
  ActivityEvidenceLinkageGroup,
  ActivityEvidenceLinkageProposalDecision,
  ActivityEvidenceLinkageProposalRecord,
  ActivityEvidenceLinkageStatus,
} from "../../shared/contracts.js";

export interface ActivityEvidenceLinkageProposalDecisionPersistenceRecord {
  proposalId: string;
  decision: ActivityEvidenceLinkageProposalDecision;
  decidedAt: Date;
}

export interface ActivityEvidenceLinkageResultPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string;
  status: ActivityEvidenceLinkageStatus;
  groups: ActivityEvidenceLinkageGroup[];
  proposals: ActivityEvidenceLinkageProposalRecord[];
  proposalDecisions: ActivityEvidenceLinkageProposalDecisionPersistenceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityEvidenceLinkageResultUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string;
  status: ActivityEvidenceLinkageStatus;
  groups: ActivityEvidenceLinkageGroup[];
  proposals: ActivityEvidenceLinkageProposalRecord[];
  proposalDecisions: ActivityEvidenceLinkageProposalDecisionPersistenceRecord[];
}
