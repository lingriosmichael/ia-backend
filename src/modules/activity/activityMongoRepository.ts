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
  ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
  ActivityLlmTokenLedgerIncrement,
  ActivityPersistenceRecord,
  SystemActivityEnsureInput,
  ActivityUpdateInput,
} from "./activityPersistence.js";

function toActivityRecord(
  document: ActivityMongoHydratedDocument | null,
): ActivityPersistenceRecord | null {
  if (!document) {
    return null;
  }

  const clarificationAnswers: ActivityAnalysisV2ClarificationAnswerPersistenceRecord[] =
    (document.activityAnalysisV2ClarificationAnswers ?? []).map((answer) => ({
      questionId: answer.questionId,
      goalId: answer.goalId ?? null,
      prompt: answer.prompt,
      kind: answer.kind as ActivityAnalysisV2ClarificationAnswerPersistenceRecord["kind"],
      questionDomain:
        answer.questionDomain as ActivityAnalysisV2ClarificationAnswerPersistenceRecord["questionDomain"],
      options: answer.options ? [...answer.options] : null,
      recommendedOption: answer.recommendedOption ?? null,
      recommendedConfidence: answer.recommendedConfidence ?? null,
      isBlocking: answer.isBlocking,
      questionCode:
        answer.questionCode as ActivityAnalysisV2ClarificationAnswerPersistenceRecord["questionCode"],
      targetTableName: answer.targetTableName ?? null,
      targetColumnName: answer.targetColumnName ?? null,
      answeredValue: answer.answeredValue,
      answeredById: answer.answeredById,
      answeredAt: answer.answeredAt,
    }));

  return {
    id: document._id.toString(),
    projectId: document.projectId,
    systemType: document.systemType ?? null,
    name: document.name,
    description: document.description ?? null,
    activityType: document.activityType ?? null,
    startDate: document.startDate ?? null,
    endDate: document.endDate ?? null,
    targetAudience: document.targetAudience ?? null,
    objectives: document.objectives ?? null,
    output: document.output ?? null,
    concernTaggingInstruction: document.concernTaggingInstruction ?? null,
    status: document.status,
    interpretationAcknowledgedAt: document.interpretationAcknowledgedAt ?? null,
    interpretationAcknowledgedById:
      document.interpretationAcknowledgedById ?? null,
    activityAnalysisV2ClarificationAnswers: clarificationAnswers,
    llmTokenLedger: {
      totalPromptTokensLifetime:
        document.llmTokenLedger?.totalPromptTokensLifetime ?? 0,
      totalCompletionTokensLifetime:
        document.llmTokenLedger?.totalCompletionTokensLifetime ?? 0,
      totalTokensLifetime: document.llmTokenLedger?.totalTokensLifetime ?? 0,
    },
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

  async ensureSystemActivity(
    input: SystemActivityEnsureInput,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    const document = await applyMongoSession(
      ActivityMongoModel.findOneAndUpdate(
        {
          projectId: input.projectId,
          systemType: input.systemType,
        },
        {
          $set: {
            name: input.name,
            systemType: input.systemType,
          },
          $setOnInsert: {
            _id: createDocumentId(),
            projectId: input.projectId,
            createdById: input.createdById,
            description: null,
            activityType: null,
            startDate: null,
            endDate: null,
            targetAudience: null,
            objectives: null,
            output: null,
            concernTaggingInstruction: null,
            status: "active",
          },
        },
        {
          upsert: true,
          returnDocument: "after",
        },
      ),
      session,
    ).exec();

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

  async upsertClarificationAnswer(
    activityId: string,
    answer: ActivityAnalysisV2ClarificationAnswerPersistenceRecord,
    session: DatabaseSession,
  ): Promise<ActivityPersistenceRecord> {
    // Two atomic array operators (pull, then push) instead of a
    // read-modify-write of the whole array: concurrent answers to different
    // questions never race on a full-array $set and clobber each other.
    await applyMongoSession(
      ActivityMongoModel.updateOne(
        { _id: activityId },
        {
          $pull: {
            activityAnalysisV2ClarificationAnswers: {
              questionId: answer.questionId,
            },
          },
        },
      ),
      session,
    ).exec();

    const document = await applyMongoSession(
      ActivityMongoModel.findByIdAndUpdate(
        activityId,
        {
          $push: { activityAnalysisV2ClarificationAnswers: answer },
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

  async incrementLlmTokenLedger(
    activityId: string,
    increment: ActivityLlmTokenLedgerIncrement,
    session: DatabaseSession,
  ): Promise<void> {
    const document = await applyMongoSession(
      ActivityMongoModel.findByIdAndUpdate(
        activityId,
        {
          $inc: {
            "llmTokenLedger.totalPromptTokensLifetime":
              increment.totalPromptTokensLifetime,
            "llmTokenLedger.totalCompletionTokensLifetime":
              increment.totalCompletionTokensLifetime,
            "llmTokenLedger.totalTokensLifetime": increment.totalTokensLifetime,
          },
        },
        {
          returnDocument: "after",
        },
      ).select({ _id: 1 }),
      session,
    ).exec();

    if (!document) {
      throw new AppError("Activity not found.", 404, "activity_not_found");
    }
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

  async deleteByProject(
    projectId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ActivityMongoModel.deleteMany({
        projectId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
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
