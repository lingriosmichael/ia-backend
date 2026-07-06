import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import { EntityMappingMongoModel } from "./entityMappingModel.js";
import { ParsedRepresentationMongoModel } from "./parsedRepresentationModel.js";
import { PrivacyReviewMongoModel } from "./privacyReviewModel.js";
import { PrivacySafeRepresentationMongoModel } from "./privacySafeRepresentationModel.js";

export class ProcessingResourceCleanupService {
  async deleteByProjectId(
    projectId: string,
    _session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      ParsedRepresentationMongoModel.deleteMany({ projectId }).exec(),
      PrivacyReviewMongoModel.deleteMany({ projectId }).exec(),
      PrivacySafeRepresentationMongoModel.deleteMany({ projectId }).exec(),
      EntityMappingMongoModel.deleteMany({ projectId }).exec(),
    ]);
  }

  async deleteByActivityId(
    activityId: string,
    _session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      ParsedRepresentationMongoModel.deleteMany({ activityId }).exec(),
      PrivacyReviewMongoModel.deleteMany({ activityId }).exec(),
      PrivacySafeRepresentationMongoModel.deleteMany({ activityId }).exec(),
      EntityMappingMongoModel.deleteMany({ activityId }).exec(),
    ]);
  }

  async deleteByUploadMetadataId(
    uploadMetadataId: string,
    _session: DatabaseSession,
  ): Promise<void> {
    await Promise.all([
      ParsedRepresentationMongoModel.deleteMany({ uploadMetadataId }).exec(),
      PrivacyReviewMongoModel.deleteMany({ uploadMetadataId }).exec(),
      PrivacySafeRepresentationMongoModel.deleteMany({ uploadMetadataId }).exec(),
      EntityMappingMongoModel.deleteMany({ uploadMetadataId }).exec(),
    ]);
  }
}
