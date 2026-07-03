import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessingJobRecord } from "../../../shared/contracts.js";
import { AIOrchestrationService } from "./aiOrchestrationService.js";
import { defaultAIPipelines } from "../pipelines/pipelineCatalog.js";
import { AIPipelineRegistry } from "../pipelines/pipelineRegistry.js";
import { defaultPromptTemplates } from "../prompts/promptCatalog.js";
import { PromptRegistry } from "../prompts/promptRegistry.js";
import type {
  PipelineExecutionScheduler,
  PipelineExecutionStore,
} from "../execution/pipelineExecutionStore.js";

test("AI orchestration queues dataset interpretation with pipeline metadata", async () => {
  let queuedJobType: string | null = null;
  let queuedPayload: Record<string, unknown> | null = null;
  let scheduledExecutionId: string | null = null;

  const executionStore: PipelineExecutionStore = {
    async queueExecution(input) {
      queuedJobType = input.jobType;
      queuedPayload = input.payload ?? null;

      const queuedExecution: ProcessingJobRecord = {
        id: "job-1",
        organizationId: "org-1",
        projectId: input.projectId,
        activityId: input.activityId ?? null,
        uploadMetadataId: input.uploadMetadataId ?? null,
        jobType: input.jobType,
        status: "queued",
        triggeredById: input.userId,
        payload: input.payload ?? null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };

      return queuedExecution;
    },
  };

  const executionScheduler: PipelineExecutionScheduler = {
    schedule(executionId) {
      scheduledExecutionId = executionId;
    },
  };

  const orchestrationService = new AIOrchestrationService(
    new PromptRegistry(defaultPromptTemplates),
    new AIPipelineRegistry(defaultAIPipelines),
    executionStore,
    executionScheduler,
  );

  const execution = await orchestrationService.queueDatasetInterpretation({
    userId: "user-1",
    projectId: "project-1",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    datasetContext: {
      kind: "dataset",
      uploadId: "upload-1",
      projectId: "project-1",
      activityId: "activity-1",
      organizationId: "org-1",
      originalFileName: "evidence.csv",
      contentType: "text/csv",
      sizeBytes: 1024,
      storageKey: "activity-1/evidence.csv",
      columns: [],
    },
  });

  assert.equal(execution.id, "job-1");
  assert.equal(scheduledExecutionId, "job-1");
  assert.equal(queuedJobType, "semantic_ingestion");
  assert.equal(
    (queuedPayload as { ai?: { pipelineKey?: string } } | null)?.ai
      ?.pipelineKey,
    "interpret_dataset",
  );
});
