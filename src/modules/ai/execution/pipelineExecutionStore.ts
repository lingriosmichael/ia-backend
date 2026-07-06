import type {
  ProcessingJobRecord,
  ProcessingJobType,
} from "../../../shared/contracts.js";
import type { AIPipelineKey } from "../aiTypes.js";
import type { DatasetContext } from "../context/aiContextTypes.js";
import type { MockJobRunnerService } from "./mockJobRunnerService.js";
import type { ProcessingJobService } from "./processingJobService.js";

export interface QueuePipelineExecutionInput {
  userId: string;
  projectId: string;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  pipelineKey: AIPipelineKey;
  jobType: ProcessingJobType;
  payload?: Record<string, unknown>;
  datasetContext?: DatasetContext;
}

export interface PipelineExecutionStore {
  queueExecution(
    input: QueuePipelineExecutionInput,
  ): Promise<ProcessingJobRecord>;
}

export interface PipelineExecutionScheduler {
  schedule(executionId: string): void;
}

export class ProcessingJobPipelineExecutionStore implements PipelineExecutionStore {
  constructor(private readonly processingJobService: ProcessingJobService) {}

  async queueExecution(
    input: QueuePipelineExecutionInput,
  ): Promise<ProcessingJobRecord> {
    return this.processingJobService.create(input.userId, input.projectId, {
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
