import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  ActivityMongoModel,
  type ActivityMongoHydratedDocument,
} from "./activityModel.js";
import type { ActivityRepository } from "./activityRepository.js";
import type {
  ActivityCreateInput,
  ActivityPersistenceRecord,
  ActivityUpdateInput,
} from "./activityPersistence.js";

function toActivityRecord(
  document: ActivityMongoHydratedDocument | null,
): ActivityPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    projectId: document.projectId,
    name: document.name,
    description: document.description ?? null,
    activityType: document.activityType ?? null,
    owner: document.owner ?? null,
    startDate: document.startDate ?? null,
    endDate: document.endDate ?? null,
    objectives: document.objectives ?? null,
    successIndicators: document.successIndicators ?? null,
    targetAudience: document.targetAudience ?? null,
    additionalContext: document.additionalContext ?? null,
    status: document.status,
    interpretationAcknowledgedAt: document.interpretationAcknowledgedAt ?? null,
    interpretationAcknowledgedById:
      document.interpretationAcknowledgedById ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoActivityRepository implements ActivityRepository {
  async create(
    input: ActivityCreateInput,
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    const document = await ActivityMongoModel.create({
      _id: createDocumentId(),
      ...input,
      status: input.status ?? "active",
    });

    return toActivityRecord(document) as ActivityPersistenceRecord;
  }

  async findById(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null> {
    const document = await ActivityMongoModel.findById(activityId).exec();
    return toActivityRecord(document);
  }

  async update(
    activityId: string,
    input: ActivityUpdateInput,
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    const document = await ActivityMongoModel.findByIdAndUpdate(
      activityId,
      {
        $set: input,
      },
      {
        returnDocument: "after",
      },
    ).exec();

    const record = toActivityRecord(document);

    if (!record) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }

    return record;
  }

  async listByProject(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]> {
    const documents = await ActivityMongoModel.find({ projectId })
      .sort({ createdAt: 1 })
      .exec();

    return documents
      .map((document) => toActivityRecord(document))
      .filter((document): document is ActivityPersistenceRecord =>
        Boolean(document),
      );
  }

  async listByProjectIds(
    projectIds: string[],
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const documents = await ActivityMongoModel.find({
      projectId: {
        $in: projectIds,
      },
    })
      .sort({ projectId: 1, createdAt: 1 })
      .exec();

    return documents
      .map((document) => toActivityRecord(document))
      .filter((document): document is ActivityPersistenceRecord =>
        Boolean(document),
      );
  }

  async deleteById(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null> {
    const document =
      await ActivityMongoModel.findByIdAndDelete(activityId).exec();
    return toActivityRecord(document);
  }
}
