import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type { ActivityEvidenceLinkageProposalDecision } from "../../shared/contracts.js";
import type {
  ActivityEvidenceLinkageResultPersistenceRecord,
  ActivityEvidenceLinkageResultUpsertInput,
} from "./activityEvidenceLinkageResultPersistence.js";

export interface ActivityEvidenceLinkageResultRepository {
  upsertByActivityId(
    input: ActivityEvidenceLinkageResultUpsertInput,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord>;
  // Atomically sets a single proposal's decision without reading and
  // rewriting the whole proposalDecisions array — two different proposals
  // on the same activity can be reviewed concurrently, and a
  // read-modify-write on the full array would let the second writer's
  // stale snapshot silently drop the first writer's decision.
  upsertProposalDecision(
    activityId: string,
    proposalId: string,
    decision: ActivityEvidenceLinkageProposalDecision,
    decidedAt: Date,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord | null>;
  findByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord | null>;
  deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number>;
  deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number>;
}
