import {
  AIExecutionMongoModel,
  type AIExecutionMongoHydratedDocument,
} from "./aiExecutionModel.js";
import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import { createDocumentId } from "../../../shared/database/documentId.js";
import { AppError } from "../../../shared/errors/appError.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";
import type {
  AIExecutionCreateInput,
  AIExecutionPersistenceRecord,
  AIExecutionUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

function toPlainExecution(
  document: AIExecutionMongoHydratedDocument | null,
): AIExecutionPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId ?? null,
    triggeredById: document.triggeredById,
    jobType: document.jobType,
    status: document.status,
    payload:
      document.payload && typeof document.payload === "object"
        ? (document.payload as Record<string, unknown>)
        : null,
    errorMessage: document.errorMessage ?? null,
    startedAt: document.startedAt ?? null,
    completedAt: document.completedAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoAIExecutionRepository implements ProcessingJobRepository {
  async create(
    input: AIExecutionCreateInput,
    _session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord> {
    const document = await AIExecutionMongoModel.create({
      _id: createDocumentId(),
      ...input,
      status: "queued",
    });

    return toPlainExecution(document) as AIExecutionPersistenceRecord;
  }

  async findById(
    executionId: string,
    _session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord | null> {
    const document = await AIExecutionMongoModel.findById(executionId).exec();
    return toPlainExecution(document);
  }

  async listByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord[]> {
    const documents = await AIExecutionMongoModel.find({ activityId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toPlainExecution(document))
      .filter((document): document is AIExecutionPersistenceRecord =>
        Boolean(document),
      );
  }

  async listRecentByProject(
    projectId: string,
    limit: number,
    _session: DatabaseSession,
  ): Promise<
    Array<
      Pick<
        AIExecutionPersistenceRecord,
        "id" | "activityId" | "status" | "createdAt"
      >
    >
  > {
    const documents = await AIExecutionMongoModel.find({ projectId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({
        _id: 1,
        activityId: 1,
        status: 1,
        createdAt: 1,
      })
      .exec();

    return documents.map((document) => ({
      id: document._id.toString(),
      activityId: document.activityId ?? null,
      status: document.status,
      createdAt: document.createdAt,
    }));
  }

  async countByActivityIds(
    activityIds: string[],
    _session: DatabaseSession,
  ): Promise<Record<string, number>> {
    if (activityIds.length === 0) {
      return {};
    }

    const groupedDocuments = await AIExecutionMongoModel.aggregate<{
      _id: string | null;
      count: number;
    }>([
      {
        $match: {
          activityId: {
            $in: activityIds,
          },
        },
      },
      {
        $group: {
          _id: "$activityId",
          count: { $sum: 1 },
        },
      },
    ]).exec();

    return Object.fromEntries(
      groupedDocuments
        .filter(
          (document): document is { _id: string; count: number } =>
            typeof document._id === "string",
        )
        .map((document) => [document._id, document.count]),
    );
  }

  async countByProjectStatuses(
    projectId: string,
    statuses: AIExecutionPersistenceRecord["status"][],
    _session: DatabaseSession,
  ): Promise<number> {
    return AIExecutionMongoModel.countDocuments({
      projectId,
      status: {
        $in: statuses,
      },
    }).exec();
  }

  async update(
    executionId: string,
    input: AIExecutionUpdateInput,
    _session: DatabaseSession,
  ): Promise<AIExecutionPersistenceRecord> {
    const document = await AIExecutionMongoModel.findByIdAndUpdate(
      executionId,
      {
        $set: input,
      },
      {
        new: true,
      },
    ).exec();

    const record = toPlainExecution(document);

    if (!record) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    return record;
  }
}
