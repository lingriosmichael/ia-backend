import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRecord } from "../../../shared/contracts.js";
import { AIExecutionRunnerService } from "./aiExecutionRunnerService.js";
import type { ProcessingJobRepository } from "./processingJobRepository.js";
import { defaultAIPipelines } from "../pipelines/pipelineCatalog.js";
import { AIPipelineRuntimeRegistry } from "../pipelines/pipelineRuntimeRegistry.js";
import { AIArtifactService } from "../artifact/aiArtifactService.js";
import type { AIPipelineRuntime } from "../pipelines/pipelineRuntime.js";

test("AI execution runner stores a structured artifact and completes the job", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let createdArtifactId: string | null = null;

  const processingJobRepository = {
    findById: async () => ({
      id: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      activityId: "activity-1",
      uploadMetadataId: "upload-1",
      triggeredById: "user-1",
      jobType: "semantic_ingestion",
      status: "queued",
      payload: {
        ai: {
          pipelineKey: "interpret_dataset",
          promptTemplateId: "interpretation.dataset.v1",
          requiredContextKinds: ["dataset"],
        },
      },
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: async (_jobId: string, input: Record<string, unknown>) => {
      updates.push(input);
      return {
        id: "job-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        triggeredById: "user-1",
        jobType: "semantic_ingestion",
        status: "completed",
        payload: input.payload ?? null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  } as unknown as ProcessingJobRepository;

  const artifactService = {
    createPipelineArtifact: async () => {
      const createdArtifact: ResultRecord = {
        id: "result-1",
        organizationId: "org-1",
        projectId: "project-1",
        activityId: "activity-1",
        uploadMetadataId: "upload-1",
        processingJobId: "job-1",
        resultType: "semantic_summary",
        status: "pending",
        payload: {
          output: {
            summary: {
              title: "Dataset interpretation",
            },
          },
        },
        createdById: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      createdArtifactId = createdArtifact.id;
      return createdArtifact;
    },
  } as unknown as AIArtifactService;

  const pipelineRuntime: AIPipelineRuntime = {
    definition: defaultAIPipelines[0]!,
    async execute() {
      return {
        pipeline: defaultAIPipelines[0]!,
        contexts: [
          {
            kind: "dataset",
            uploadId: "upload-1",
            projectId: "project-1",
            activityId: "activity-1",
            organizationId: "org-1",
            originalFileName: "evidence.csv",
            contentType: "text/csv",
            sizeBytes: 100,
            storageKey: "activity-1/evidence.csv",
            columns: [],
          },
        ],
        renderedPrompt: {
          templateId: "interpretation.dataset.v1",
          version: "v1",
          systemPrompt: "system",
          userPrompt: "user",
        },
        providerResponse: {
          providerKey: "mock",
          model: "mock-structured-v1",
          output: {
            summary: {
              title: "Dataset interpretation",
            },
          },
          usage: {
            inputTokens: null,
            outputTokens: null,
          },
        },
      };
    },
  };

  const runner = new AIExecutionRunnerService(
    processingJobRepository,
    new AIPipelineRuntimeRegistry([pipelineRuntime]),
    artifactService,
  );

  await runner.run("job-1");

  assert.equal(createdArtifactId, "result-1");
  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.status, "processing");
  assert.equal(updates[1]?.status, "completed");
  assert.equal(
    (updates[1]?.payload as { artifact?: { resultRecordId?: string } })
      ?.artifact?.resultRecordId,
    "result-1",
  );
});
