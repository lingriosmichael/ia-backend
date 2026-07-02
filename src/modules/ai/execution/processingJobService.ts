import { AIExecutionService } from "./aiExecutionService.js";

export class ProcessingJobService {
  constructor(private readonly aiExecutionService: AIExecutionService) {}

  async listByActivity(userId: string, activityId: string) {
    return this.aiExecutionService.listByActivity(userId, activityId);
  }

  async create(
    userId: string,
    projectId: string,
    input: {
      activityId?: string | null;
      uploadMetadataId?: string | null;
      jobType: "semantic_ingestion" | "manual_review" | "export" | "other";
      payload?: Record<string, unknown>;
    },
  ) {
    return this.aiExecutionService.create(userId, projectId, input);
  }

  async update(
    userId: string,
    processingJobId: string,
    input: {
      status?: "queued" | "processing" | "completed" | "failed" | "cancelled";
      payload?: Record<string, unknown> | null;
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ) {
    return this.aiExecutionService.update(userId, processingJobId, input);
  }

  async getById(userId: string, processingJobId: string) {
    return this.aiExecutionService.getById(userId, processingJobId);
  }
}
