import {
  ProcessingJobMongoModel,
  type ProcessingJobMongoHydratedDocument,
} from "./processingJobModel.js";
import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import { createDocumentId } from "../../../shared/database/documentId.js";
import {
  applyMongoSession,
  getMongoSessionOptions,
} from "../../../shared/database/mongoSession.js";
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
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord> {
    try {
      const [document] = await ProcessingJobMongoModel.create(
        [
          {
            _id: createDocumentId(),
            ...input,
            status: "queued",
          },
        ],
        getMongoSessionOptions(session),
      );

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
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProcessingJobMongoModel.findById(executionId),
      session,
    ).exec();
    return toPlainProcessingJob(document);
  }

  async listByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord[]> {
    const documents = await applyMongoSession(
      ProcessingJobMongoModel.find({ activityId }).sort({ createdAt: -1 }),
      session,
    ).exec();

    return documents
      .map((document) => toPlainProcessingJob(document))
      .filter((document): document is ProcessingJobPersistenceRecord =>
        Boolean(document),
      );
  }

  async listRecentByProject(
    projectId: string,
    limit: number,
    session: DatabaseSession,
  ): Promise<
    Array<
      Pick<
        ProcessingJobPersistenceRecord,
        "id" | "activityId" | "status" | "createdAt"
      >
    >
  > {
    const documents = await applyMongoSession(
      ProcessingJobMongoModel.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select({
          _id: 1,
          activityId: 1,
          status: 1,
          createdAt: 1,
        }),
      session,
    ).exec();

    return documents.map((document) => ({
      id: document._id.toString(),
      activityId: document.activityId ?? null,
      status: document.status,
      createdAt: document.createdAt,
    }));
  }

  async countByActivityIds(
    activityIds: string[],
    session: DatabaseSession,
  ): Promise<Record<string, number>> {
    if (activityIds.length === 0) {
      return {};
    }

    const aggregate = ProcessingJobMongoModel.aggregate<{
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
    ]);

    if (session) {
      aggregate.session(session);
    }

    const groupedDocuments = await aggregate.exec();

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
    session: DatabaseSession,
  ): Promise<number> {
    return applyMongoSession(
      ProcessingJobMongoModel.countDocuments({
        projectId,
        status: {
          $in: statuses,
        },
      }),
      session,
    ).exec();
  }

  async findActiveByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProcessingJobMongoModel.findOne({
        uploadMetadataId,
        status: { $in: [...activeProcessingJobStatusValues] },
      }).sort({ createdAt: -1 }),
      session,
    ).exec();

    return toPlainProcessingJob(document);
  }

  async deleteByActivity(
    activityId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ProcessingJobMongoModel.deleteMany({
        activityId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    session: DatabaseSession,
  ): Promise<number> {
    const result = await applyMongoSession(
      ProcessingJobMongoModel.deleteMany({
        uploadMetadataId,
      }),
      session,
    ).exec();
    return result.deletedCount ?? 0;
  }

  async update(
    executionId: string,
    input: ProcessingJobUpdateInput,
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord> {
    const document = await applyMongoSession(
      ProcessingJobMongoModel.findByIdAndUpdate(
        executionId,
        {
          $set: input,
        },
        {
          returnDocument: "after",
        },
      ),
      session,
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
    session: DatabaseSession,
  ): Promise<ProcessingJobPersistenceRecord | null> {
    const document = await applyMongoSession(
      ProcessingJobMongoModel.findOneAndUpdate(
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
        { returnDocument: "after" },
      ),
      session,
    ).exec();

    return toPlainProcessingJob(document);
  }
}
