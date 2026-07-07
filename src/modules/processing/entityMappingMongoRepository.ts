import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { EntityMappingMongoModel } from "./entityMappingModel.js";
import type { EntityMappingRepository } from "./entityMappingRepository.js";
import type {
  EntityMappingReplaceContext,
  EntityMappingReplaceEntry,
} from "./entityMappingPersistence.js";

export class MongoEntityMappingRepository implements EntityMappingRepository {
  async replaceByProcessingJobId(
    processingJobId: string,
    context: EntityMappingReplaceContext,
    entries: EntityMappingReplaceEntry[],
    _session: DatabaseSession,
  ): Promise<void> {
    await EntityMappingMongoModel.deleteMany({ processingJobId }).exec();

    if (entries.length === 0) {
      return;
    }

    await EntityMappingMongoModel.insertMany(
      entries.map((entry) => ({
        _id: createDocumentId(),
        organizationId: context.organizationId,
        projectId: context.projectId,
        activityId: context.activityId,
        uploadMetadataId: context.uploadMetadataId,
        processingJobId,
        entityType: entry.entityType,
        payload: entry.payload,
      })),
    );
  }

  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await EntityMappingMongoModel.deleteMany({
      projectId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByActivityId(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await EntityMappingMongoModel.deleteMany({
      activityId,
    }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<number> {
    const result = await EntityMappingMongoModel.deleteMany({
      uploadMetadataId,
    }).exec();
    return result.deletedCount ?? 0;
  }
}
