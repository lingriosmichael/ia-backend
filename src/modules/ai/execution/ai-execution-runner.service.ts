import { databaseSession } from "../../../shared/database/database-client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { AIArtifactService } from "../artifact/ai-artifact.service.js";
import type { ProcessingJobRepository } from "./processing-job.repository.js";
import type { ChatContext, ReportContext } from "../context/ai-context.types.js";
import type { AIPipelineKey } from "../ai.types.js";
import { AIPipelineRuntimeRegistry } from "../pipelines/pipeline-runtime-registry.js";

interface ExecutionPayloadAIBlock {
  pipelineKey?: AIPipelineKey;
  providerKey?: string | null;
}

interface ExecutionPayloadContextBlock {
  report?: Omit<ReportContext, "kind"> | null;
  chat?: Omit<ChatContext, "kind"> | null;
}

function getExecutionPayloadAIBlock(
  payload: Record<string, unknown> | null,
): ExecutionPayloadAIBlock | null {
  if (!payload) {
    return null;
  }

  const aiBlock = payload.ai;
  if (!aiBlock || typeof aiBlock !== "object") {
    return null;
  }

  return aiBlock as ExecutionPayloadAIBlock;
}

function getExecutionPayloadContextBlock(
  payload: Record<string, unknown> | null,
): ExecutionPayloadContextBlock | null {
  if (!payload) {
    return null;
  }

  const contextBlock = payload.context;
  if (!contextBlock || typeof contextBlock !== "object") {
    return null;
  }

  return contextBlock as ExecutionPayloadContextBlock;
}

export class AIExecutionRunnerService {
  constructor(
    private readonly processingJobRepository: ProcessingJobRepository,
    private readonly pipelineRuntimeRegistry: AIPipelineRuntimeRegistry,
    private readonly artifactService: AIArtifactService,
  ) {}

  async run(processingJobId: string) {
    const job = await this.processingJobRepository.findById(
      processingJobId,
      databaseSession,
    );

    if (!job) {
      throw new AppError("Processing job not found.", 404, "processing_job_not_found");
    }

    const payload = (job.payload as Record<string, unknown> | null) ?? null;
    const aiBlock = getExecutionPayloadAIBlock(payload);

    if (!aiBlock?.pipelineKey) {
      throw new AppError(
        "Processing job does not contain AI execution metadata.",
        400,
        "ai_execution_metadata_missing",
      );
    }

    const contextBlock = getExecutionPayloadContextBlock(payload);
    const pipelineRuntime = this.pipelineRuntimeRegistry.getByKey(aiBlock.pipelineKey);

    await this.processingJobRepository.update(
      processingJobId,
      {
        status: "processing",
        startedAt: new Date(),
      },
      databaseSession,
    );

    try {
      const executionResult = await pipelineRuntime.execute({
        userId: job.triggeredById,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        providerKey: aiBlock.providerKey ?? null,
        reportContext: contextBlock?.report ?? undefined,
        chatContext: contextBlock?.chat ?? undefined,
      });

      const artifact = await this.artifactService.createPipelineArtifact({
        userId: job.triggeredById,
        projectId: job.projectId,
        activityId: job.activityId,
        uploadMetadataId: job.uploadMetadataId,
        processingJobId: job.id,
        pipeline: executionResult.pipeline,
        renderedPrompt: executionResult.renderedPrompt,
        providerResponse: executionResult.providerResponse,
        contexts: executionResult.contexts,
      });

      await this.processingJobRepository.update(
        processingJobId,
        {
          status: "completed",
          completedAt: new Date(),
          payload: {
            ...(payload ?? {}),
            ai: {
              ...aiBlock,
              executedAt: new Date().toISOString(),
            },
            artifact: {
              resultRecordId: artifact.id,
              resultType: artifact.resultType,
            },
            provider: {
              key: executionResult.providerResponse.providerKey,
              model: executionResult.providerResponse.model,
              usage: executionResult.providerResponse.usage,
            },
            output: executionResult.providerResponse.output,
          },
        },
        databaseSession,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI execution failed unexpectedly.";

      await this.processingJobRepository.update(
        processingJobId,
        {
          status: "failed",
          completedAt: new Date(),
          errorMessage: message,
        },
        databaseSession,
      );

      throw error;
    }
  }
}
