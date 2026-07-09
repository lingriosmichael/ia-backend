import {
  ResultRecordMongoModel,
  type ResultRecordMongoHydratedDocument,
} from "./resultRecordModel.js";
import type { DatabaseSession } from "../../../shared/database/databaseClient.js";
import { createDocumentId } from "../../../shared/database/documentId.js";
import { AppError } from "../../../shared/errors/appError.js";
import type { ResultRepository } from "./resultRepository.js";
import type {
  ResultRecordCreateInput,
  ResultRecordPersistenceRecord,
  ResultRecordUpdateInput,
} from "../persistence/aiPersistenceTypes.js";

function toPlainResultRecord(
  document: ResultRecordMongoHydratedDocument | null,
): ResultRecordPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadMetadataId: document.uploadMetadataId ?? null,
    processingJobId: document.processingJobId ?? null,
    createdById: document.createdById,
    resultType: document.resultType,
    status: document.status,
    payload:
      document.payload && typeof document.payload === "object"
        ? (document.payload as Record<string, unknown>)
        : null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoResultRepository implements ResultRepository {
  async create(
    input: ResultRecordCreateInput,
    _session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord> {
    const document = await ResultRecordMongoModel.create({
      _id: createDocumentId(),
      ...input,
      status: "pending",
    });

    return toPlainResultRecord(document) as ResultRecordPersistenceRecord;
  }

  async findById(
    artifactId: string,
    _session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord | null> {
    const document = await ResultRecordMongoModel.findById(artifactId).exec();
    return toPlainResultRecord(document);
  }

  async listByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord[]> {
    const documents = await ResultRecordMongoModel.find({ activityId })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toPlainResultRecord(document))
      .filter((document): document is ResultRecordPersistenceRecord =>
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
        ResultRecordPersistenceRecord,
        "id" | "activityId" | "status" | "createdAt"
      >
    >
  > {
    const documents = await ResultRecordMongoModel.find({ projectId })
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

    const groupedDocuments = await ResultRecordMongoModel.aggregate<{
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
    statuses: ResultRecordPersistenceRecord["status"][],
    _session: DatabaseSession,
  ): Promise<number> {
    return ResultRecordMongoModel.countDocuments({
      projectId,
      status: {
        $in: statuses,
      },
    }).exec();
  }

  async deleteByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await ResultRecordMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await ResultRecordMongoModel.deleteMany({
      uploadMetadataId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async update(
    artifactId: string,
    input: ResultRecordUpdateInput,
    _session: DatabaseSession,
  ): Promise<ResultRecordPersistenceRecord> {
    const document = await ResultRecordMongoModel.findByIdAndUpdate(
      artifactId,
      {
        $set: input,
      },
      {
        returnDocument: "after",
      },
    ).exec();

    const record = toPlainResultRecord(document);

    if (!record) {
      throw new AppError(
        "Result record not found.",
        404,
        "result_record_not_found",
      );
    }

    return record;
  }
}
