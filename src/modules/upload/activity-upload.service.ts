import type { MultipartFile } from "@fastify/multipart";
import type { ActivityUploadResponse } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors/app-error.js";
import { AuthorizationService } from "../../shared/auth/authorization.service.js";
import { ActivityService } from "../activity/activity.service.js";
import { AIOrchestrationService } from "../ai/orchestration/ai-orchestration.service.js";
import { FileStorageService } from "./file-storage.service.js";
import { UploadMetadataService } from "./upload-metadata.service.js";

export class ActivityUploadService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly fileStorageService: FileStorageService,
    private readonly uploadMetadataService: UploadMetadataService,
    private readonly aiOrchestrationService: AIOrchestrationService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async uploadForActivity(
    userId: string,
    activityId: string,
    file: MultipartFile | undefined,
  ): Promise<ActivityUploadResponse> {
    if (!file) {
      throw new AppError("A file is required.", 400, "file_required");
    }

    await this.authorizationService.canUploadToActivity(userId, activityId);
    const activity = await this.activityService.getById(userId, activityId);
    const storedFile = await this.fileStorageService.storeActivityUpload(
      activityId,
      file,
    );

    const upload = await this.uploadMetadataService.create(userId, activity.projectId, {
      activityId,
      originalFileName: storedFile.originalFileName,
      contentType: storedFile.contentType ?? undefined,
      sizeBytes: storedFile.sizeBytes,
      storageKey: storedFile.storageKey,
    });

    const updatedUpload = await this.uploadMetadataService.update(userId, upload.id, {
      status: "uploaded",
    });

    const job = await this.aiOrchestrationService.queueDatasetInterpretation({
      userId,
      projectId: activity.projectId,
      activityId,
      uploadMetadataId: upload.id,
      datasetContext: {
        kind: "dataset",
        uploadId: upload.id,
        projectId: activity.projectId,
        activityId,
        organizationId: upload.organizationId,
        originalFileName: storedFile.originalFileName,
        contentType: storedFile.contentType ?? null,
        sizeBytes: storedFile.sizeBytes,
        storageKey: storedFile.storageKey,
        columns: [],
      },
    });

    return {
      upload: updatedUpload,
      execution: job,
      job,
    };
  }
}
