import type { OutcomeEvidenceLink } from "../../shared/contracts.js";

export interface OutcomeEvidenceLinkMatchDiagnostics {
  matchedCount: number;
  baselineCount: number;
  comparisonCount: number;
  matchedRatio: number;
  candidateKeysConsidered: string[];
}

// A plain `Omit<Union, K>` does not distribute over a discriminated union —
// `keyof` of a union collapses to only the shared keys, so it would silently
// erase the shape-specific fields (paired_delta's beforeColumnName etc.)
// instead of omitting just `linkId` from each member. This distributes
// explicitly so both variants keep their own fields.
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type OutcomeEvidenceLinkPersistenceRecord = OutcomeEvidenceLink & {
  organizationId: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
  matchDiagnostics?: OutcomeEvidenceLinkMatchDiagnostics | null;
};

export type OutcomeEvidenceLinkCreateInput = DistributiveOmit<
  OutcomeEvidenceLink,
  "linkId"
> & {
  organizationId: string;
  projectId: string;
  // Deterministic pairing/column identity — see the unique index comment
  // on outcomeEvidenceLinkModel.ts's `proposalId` field. Computed by the
  // caller via buildPairedDeltaProposalId/buildSingleDistributionProposalId
  // rather than derived here, since the caller already needs those values
  // to run assertNotAlreadyConfirmed.
  proposalId: string;
  matchDiagnostics?: OutcomeEvidenceLinkMatchDiagnostics | null;
};
