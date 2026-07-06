import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  UploadMetadataMongoModel,
  type UploadMetadataMongoHydratedDocument,
} from "./uploadMetadataModel.js";
import type { UploadMetadataRepository } from "./uploadMetadataRepository.js";
import type {
  UploadMetadataCreateInput,
  UploadMetadataPersistenceRecord,
  UploadMetadataUpdateInput,
} from "./uploadMetadataPersistence.js";

function toUploadMetadataRecord(
  document: UploadMetadataMongoHydratedDocument | null,
): UploadMetadataPersistenceRecord | null {
  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    organizationId: document.organizationId,
    projectId: document.projectId,
    activityId: document.activityId ?? null,
    uploadedById: document.uploadedById,
    logicalEvidenceId: document.logicalEvidenceId ?? document._id.toString(),
    versionNumber: document.versionNumber ?? 1,
    replacesUploadMetadataId: document.replacesUploadMetadataId ?? null,
    supersededAt: document.supersededAt ?? null,
    originalFileName: document.originalFileName,
    contentType: document.contentType ?? null,
    sizeBytes: document.sizeBytes ?? null,
    storageKey: document.storageKey ?? null,
    originalFileDeletedAt: document.originalFileDeletedAt ?? null,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoUploadMetadataRepository implements UploadMetadataRepository {
  async create(
    input: UploadMetadataCreateInput,
    _session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord> {
    const uploadMetadataId = createDocumentId();
    const document = await UploadMetadataMongoModel.create({
      _id: uploadMetadataId,
      ...input,
      logicalEvidenceId: input.logicalEvidenceId ?? uploadMetadataId,
      versionNumber: input.versionNumber ?? 1,
      replacesUploadMetadataId: input.replacesUploadMetadataId ?? null,
      supersededAt: null,
      originalFileDeletedAt: null,
      status: "pending",
    });

    return toUploadMetadataRecord(document) as UploadMetadataPersistenceRecord;
  }

  async listByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord[]> {
    const documents = await UploadMetadataMongoModel.find({
      activityId,
      status: { $ne: "archived" },
      supersededAt: null,
    })
      .sort({ createdAt: -1 })
      .exec();

    return documents
      .map((document) => toUploadMetadataRecord(document))
      .filter((document): document is UploadMetadataPersistenceRecord =>
        Boolean(document),
      );
  }

  async findById(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord | null> {
    const document =
      await UploadMetadataMongoModel.findById(uploadMetadataId).exec();
    return toUploadMetadataRecord(document);
  }

  async listRecentByProject(
    projectId: string,
    limit: number,
    _session: DatabaseSession,
  ): Promise<
    Array<
      Pick<UploadMetadataPersistenceRecord, "id" | "activityId" | "createdAt">
    >
  > {
    const documents = await UploadMetadataMongoModel.find({
      projectId,
      status: { $ne: "archived" },
      supersededAt: null,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({
        _id: 1,
        activityId: 1,
        createdAt: 1,
      })
      .exec();

    return documents.map((document) => ({
      id: document._id.toString(),
      activityId: document.activityId ?? null,
      createdAt: document.createdAt,
    }));
  }

  async listStorageKeysByProject(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<string[]> {
    const documents = await UploadMetadataMongoModel.find({
      projectId,
      storageKey: { $ne: null },
    })
      .select({
        storageKey: 1,
      })
      .exec();

    return documents
      .map((document) => document.storageKey)
      .filter((storageKey): storageKey is string => Boolean(storageKey));
  }

  async listStorageKeysByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<string[]> {
    const documents = await UploadMetadataMongoModel.find({
      activityId,
      storageKey: { $ne: null },
    })
      .select({
        storageKey: 1,
      })
      .exec();

    return documents
      .map((document) => document.storageKey)
      .filter((storageKey): storageKey is string => Boolean(storageKey));
  }

  async countByProject(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    return UploadMetadataMongoModel.countDocuments({
      projectId,
      status: { $ne: "archived" },
      supersededAt: null,
    }).exec();
  }

  async countByActivityIds(
    activityIds: string[],
    _session: DatabaseSession,
  ): Promise<Record<string, number>> {
    if (activityIds.length === 0) {
      return {};
    }

    const groupedDocuments = await UploadMetadataMongoModel.aggregate<{
      _id: string | null;
      count: number;
    }>([
      {
        $match: {
          activityId: {
            $in: activityIds,
          },
          status: {
            $ne: "archived",
          },
          supersededAt: null,
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

  async deleteByProject(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await UploadMetadataMongoModel.deleteMany({
      projectId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivity(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await UploadMetadataMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteById(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord | null> {
    const document =
      await UploadMetadataMongoModel.findByIdAndDelete(uploadMetadataId).exec();
    return toUploadMetadataRecord(document);
  }

  async update(
    uploadMetadataId: string,
    input: UploadMetadataUpdateInput,
    _session: DatabaseSession,
  ): Promise<UploadMetadataPersistenceRecord> {
    const document = await UploadMetadataMongoModel.findByIdAndUpdate(
      uploadMetadataId,
      {
        $set: input,
      },
      {
        new: true,
      },
    ).exec();

    const record = toUploadMetadataRecord(document);

    if (!record) {
      throw new AppError(
        "Upload metadata not found.",
        404,
        "upload_metadata_not_found",
      );
    }

    return record;
  }
}
