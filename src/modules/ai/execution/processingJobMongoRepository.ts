import {
  ProcessingJobMongoModel,
  type ProcessingJobMongoHydratedDocument,
} from "./processingJobModel.js";
import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import { createDocumentId } from "../../../shared/database/documentId.js";
import { isMongoDuplicateKeyError } from "../../../shared/database/mongoErrors.js";
import { AppError } from "../../../shared/errors/appError.js";
import { activeProcessingJobStatusValues } from "../../../shared/contracts.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";
import type {
  ProcessingJobCreateInput,
  ProcessingJobPersistenceRecord,
  ProcessingJobUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

function toPlainProcessingJob(
  document: ProcessingJobMongoHydratedDocument | null,
): ProcessingJobPersistenceRecord | null {
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

export class MongoProcessingJobRepository implements ProcessingJobRepository {
  async create(
    input: ProcessingJobCreateInput,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord> {
    try {
      const document = await ProcessingJobMongoModel.create({
        _id: createDocumentId(),
        ...input,
        status: "queued",
      });

      return toPlainProcessingJob(document) as ProcessingJobPersistenceRecord;
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new AppError(
          "A processing job is already active for this evidence version.",
          409,
          "processing_job_already_active",
        );
      }

      throw error;
    }
  }

  async findById(
    executionId: string,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await ProcessingJobMongoModel.findById(executionId).exec();
    return toPlainProcessingJob(document);
  }

  async listByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord[]> {
    const documents = await ProcessingJobMongoModel.find({ activityId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toPlainProcessingJob(document))
      .filter((document): document is ProcessingJobPersistenceRecord =>
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
        ProcessingJobPersistenceRecord,
        "id" | "activityId" | "status" | "createdAt"
      >
    >
  > {
    const documents = await ProcessingJobMongoModel.find({ projectId })
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

    const groupedDocuments = await ProcessingJobMongoModel.aggregate<{
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
    statuses: ProcessingJobPersistenceRecord["status"][],
    _session: DatabaseSession,
  ): Promise<number> {
    return ProcessingJobMongoModel.countDocuments({
      projectId,
      status: {
        $in: statuses,
      },
    }).exec();
  }

  async findActiveByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await ProcessingJobMongoModel.findOne({
      uploadMetadataId,
      status: { $in: [...activeProcessingJobStatusValues] },
    })
      .sort({ createdAt: -1 })
      .exec();

    return toPlainProcessingJob(document);
  }

  async deleteByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await ProcessingJobMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await ProcessingJobMongoModel.deleteMany({
      uploadMetadataId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async update(
    executionId: string,
    input: ProcessingJobUpdateInput,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord> {
    const document = await ProcessingJobMongoModel.findByIdAndUpdate(
      executionId,
      {
        $set: input,
      },
      {
        new: true,
      },
    ).exec();

    const record = toPlainProcessingJob(document);

    if (!record) {
      throw new AppError(
        "Processing job not found.",
        404,
        "processing_job_not_found",
      );
    }

    return record;
  }

  async cancelIfActive(
    processingJobId: string,
    completedAt: Date,
    _session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await ProcessingJobMongoModel.findOneAndUpdate(
      {
        _id: processingJobId,
        status: { $in: [...activeProcessingJobStatusValues] },
      },
      {
        $set: {
          status: "cancelled",
          completedAt,
        },
      },
      { new: true },
    ).exec();

    return toPlainProcessingJob(document);
  }
}
