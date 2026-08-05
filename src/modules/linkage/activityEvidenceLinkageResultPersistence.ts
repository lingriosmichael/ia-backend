import type { ActivityEvidenceLinkageGroup } from "../../shared/contracts.js";

export interface ActivityEvidenceLinkageResultPersistenceRecord {
  id: string;
  organizationId: string;
  projectId: string;
  activityId: string;
  groups: ActivityEvidenceLinkageGroup[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityEvidenceLinkageResultUpsertInput {
  organizationId: string;
  projectId: string;
  activityId: string;
  groups: ActivityEvidenceLinkageGroup[];
}
