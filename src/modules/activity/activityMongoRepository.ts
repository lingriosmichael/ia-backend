import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../shared/database/mongoSession.js";
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
    aiKnowledgeSnapshot: document.aiKnowledgeSnapshot
      ? {
          generatedAt: document.aiKnowledgeSnapshot.generatedAt,
          summaryText: document.aiKnowledgeSnapshot.summaryText ?? "",
          interpretedEvidenceCount:
            document.aiKnowledgeSnapshot.interpretedEvidenceCount,
          totalEvidenceCount: document.aiKnowledgeSnapshot.totalEvidenceCount,
          insights: (document.aiKnowledgeSnapshot.insights ?? []).map(
            (insight) => ({
              id: insight.id,
              sourceType: insight.sourceType,
              text: insight.text,
              isGoalRelevant: insight.isGoalRelevant,
              sourceUploadMetadataIds: [
                ...(insight.sourceUploadMetadataIds ?? []),
              ],
            }),
          ),
        }
      : null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoActivityRepository implements ActivityRepository {
  async create(
    input: ActivityCreateInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    const [document] = await ActivityMongoModel.create(
      [
        {
          _id: createDocumentId(),
          ...input,
          status: input.status ?? "active",
        },
      ],
      getMongoSessionOptions(session),
    );

    return toActivityRecord(document) as ActivityPersistenceRecord;
  }

  async findById(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null> {
    const document = await applyMongoSession(
      ActivityMongoModel.findById(activityId),
      session,
    ).exec();
    return toActivityRecord(document);
  }

  async update(
    activityId: string,
    input: ActivityUpdateInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    const document = await applyMongoSession(
      ActivityMongoModel.findByIdAndUpdate(
        activityId,
        {
          $set: input,
        },
        {
          returnDocument: "after",
        },
      ),
      session,
    ).exec();

    const record = toActivityRecord(document);

    if (!record) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }

    return record;
  }

  async listByProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]> {
    const documents = await applyMongoSession(
      ActivityMongoModel.find({ projectId }).sort({ createdAt: 1 }),
      session,
    ).exec();

    return documents
      .map((document) => toActivityRecord(document))
      .filter((document): document is ActivityPersistenceRecord =>
        Boolean(document),
      );
  }

  async listByProjectIds(
    projectIds: string[],
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const documents = await applyMongoSession(
      ActivityMongoModel.find({
        projectId: {
          $in: projectIds,
        },
      }).sort({ projectId: 1, createdAt: 1 }),
      session,
    ).exec();

    return documents
      .map((document) => toActivityRecord(document))
      .filter((document): document is ActivityPersistenceRecord =>
        Boolean(document),
      );
  }

  async deleteById(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord | null> {
    const document = await applyMongoSession(
      ActivityMongoModel.findByIdAndDelete(activityId),
      session,
    ).exec();
    return toActivityRecord(document);
  }
}
