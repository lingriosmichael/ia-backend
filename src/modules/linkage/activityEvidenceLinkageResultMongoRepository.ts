import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { applyMongoSession } from "../../shared/database/mongoSession.js";
import {
  ActivityEvidenceLinkageResultMongoModel,
  type ActivityEvidenceLinkageResultMongoHydratedDocument,
} from "./activityEvidenceLinkageResultModel.js";
import type { ActivityEvidenceLinkageResultRepository } from "./activityEvidenceLinkageResultRepository.js";
import type {
  ActivityEvidenceLinkageResultPersistenceRecord,
  ActivityEvidenceLinkageResultUpsertInput,
} from "./activityEvidenceLinkageResultPersistence.js";

function toActivityEvidenceLinkageResultRecord(
  document: ActivityEvidenceLinkageResultMongoHydratedDocument | null,
): ActivityEvidenceLinkageResultPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId,
    status: document.status ?? "resolved",
    groups: (document.groups ??
      []) as ActivityEvidenceLinkageResultPersistenceRecord["groups"],
    proposals: (document.proposals ??
      []) as ActivityEvidenceLinkageResultPersistenceRecord["proposals"],
    proposalDecisions: (document.proposalDecisions ??
      []) as ActivityEvidenceLinkageResultPersistenceRecord["proposalDecisions"],
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoActivityEvidenceLinkageResultRepository implements ActivityEvidenceLinkageResultRepository {
  async upsertByActivityId(
    input: ActivityEvidenceLinkageResultUpsertInput,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord> {
    const document = await applyMongoSession(
      ActivityEvidenceLinkageResultMongoModel.findOneAndUpdate(
        { activityId: input.activityId },
        {
          $set: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            activityId: input.activityId,
            status: input.status,
            groups: input.groups,
            proposals: input.proposals,
            proposalDecisions: input.proposalDecisions,
          },
        },
        { upsert: true, returnDocument: "after" },
      ),
      session,
    ).exec();

    return toActivityEvidenceLinkageResultRecord(
      document,
    ) as ActivityEvidenceLinkageResultPersistenceRecord;
  }

  async findByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityEvidenceLinkageResultPersistenceRecord | null> {
    const document = await applyMongoSession(
      ActivityEvidenceLinkageResultMongoModel.findOne({ activityId }),
      session,
    ).exec();
    return toActivityEvidenceLinkageResultRecord(document);
  }

  async deleteByProjectId(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ActivityEvidenceLinkageResultMongoModel.deleteMany({ projectId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ActivityEvidenceLinkageResultMongoModel.deleteMany({ activityId }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }
}
