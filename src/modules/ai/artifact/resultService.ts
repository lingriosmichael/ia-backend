import { AIArtifactRecordService } from "./aiArtifactRecordService.js";

export class ResultService {
  constructor(
    private readonly aiArtifactRecordService: AIArtifactRecordService,
  ) {}

  async listByActivity(userId: string, activityId: string) {
    return this.aiArtifactRecordService.listByActivity(userId, activityId);
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      activityId?: string | null;
      uploadMetadataId?: string | null;
      processingJobId?: string | null;
      resultType:
        "semantic_summary" | "activity_snapshot" | "project_snapshot" | "other";
      payload?: Record<string, unknown>;
    },
  ) {
    return this.aiArtifactRecordService.create(userId, projectId, input);
  }

  async update(
    userId: string,
    resultRecordId: string,
    input: {
      status?: "pending" | "available" | "archived";
      payload?: Record<string, unknown> | null;
    },
  ) {
    return this.aiArtifactRecordService.update(userId, resultRecordId, input);
  }
}
