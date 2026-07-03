import type { MultipartFile } from "@fastify/multipart";
import type { ActivityUploadResponse } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors/appError.js";
import { AuthorizationService } from "../../shared/auth/authorizationService.js";
import { ActivityService } from "../activity/activityService.js";
import { AIOrchestrationService } from "../ai/orchestration/aiOrchestrationService.js";
import { FileStorageService } from "./fileStorageService.js";
import { UploadMetadataService } from "./uploadMetadataService.js";

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

    const upload = await this.uploadMetadataService.create(
      userId,
      activity.projectId,
      {
        activityId,
        originalFileName: storedFile.originalFileName,
        contentType: storedFile.contentType ?? undefined,
        sizeBytes: storedFile.sizeBytes,
        storageKey: storedFile.storageKey,
      },
    );

    const updatedUpload = await this.uploadMetadataService.update(
      userId,
      upload.id,
      {
        status: "uploaded",
      },
    );

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
