import type { ProcessingJobRecord } from "../../../shared/contracts.js";
import type { AIPipelineKey } from "../aiTypes.js";
import type { DatasetContext } from "../context/aiContextTypes.js";
import type { AIExecutionService } from "./aiExecutionService.js";
import type { MockJobRunnerService } from "./mockJobRunnerService.js";

export interface QueuePipelineExecutionInput {
  userId: string;
  projectId: string;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  pipelineKey: AIPipelineKey;
  jobType: "semantic_ingestion" | "manual_review" | "export" | "other";
  payload?: Record<string, unknown>;
  datasetContext?: DatasetContext;
}

export interface PipelineExecutionStore {
  queueExecution(input: QueuePipelineExecutionInput): Promise<ProcessingJobRecord>;
}

export interface PipelineExecutionScheduler {
  schedule(executionId: string): void;
}

export class ProcessingJobPipelineExecutionStore implements PipelineExecutionStore {
  constructor(
    private readonly aiExecutionService: AIExecutionService,
  ) {}

  async queueExecution(
    input: QueuePipelineExecutionInput,
  ): Promise<ProcessingJobRecord> {
    return this.aiExecutionService.create(input.userId, input.projectId, {
      activityId: input.activityId ?? null,
      uploadMetadataId: input.uploadMetadataId ?? null,
      jobType: input.jobType,
      payload: input.payload,
    });
  }
}

export class MockPipelineExecutionScheduler implements PipelineExecutionScheduler {
  constructor(private readonly mockJobRunnerService: MockJobRunnerService) {}

  schedule(executionId: string) {
    this.mockJobRunnerService.schedule(executionId);
  }
}
