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
  // The concernTaggingInstruction that produced the concern-tagging fields
  // currently baked into `groups`, or null if concern tagging was never
  // configured/applied for this run. See
  // EvidenceLinkageReconciliationService.applyConcernTaggingIfConfigured.
  concernTaggingInstruction: string | null;
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
  concernTaggingInstruction: string | null;
}
