import type { ProcessingJobRecord } from "../../../shared/contracts.js";
import type { AIPipelineKey } from "../aiTypes.js";
import type { ChatContext, DatasetContext, ReportContext } from "../context/aiContextTypes.js";
import type { PromptVariables } from "../context/contextBuilder.js";
import type { PipelineExecutionScheduler, PipelineExecutionStore } from "../execution/pipelineExecutionStore.js";
import { PromptRegistry } from "../prompts/promptRegistry.js";
import { PromptTemplateRenderer } from "../prompts/promptTemplate.js";
import { AIPipelineRegistry } from "../pipelines/pipelineRegistry.js";

export interface QueueAIExecutionInput {
  userId: string;
  projectId: string;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  pipelineKey: AIPipelineKey;
  providerKey?: string | null;
  payload?: Record<string, unknown>;
  datasetContext?: DatasetContext;
  reportContext?: Omit<ReportContext, "kind">;
  chatContext?: Omit<ChatContext, "kind">;
}

export class AIOrchestrationService {
  private readonly promptRenderer = new PromptTemplateRenderer();

  constructor(
    private readonly promptRegistry: PromptRegistry,
    private readonly pipelineRegistry: AIPipelineRegistry,
    private readonly executionStore: PipelineExecutionStore,
    private readonly executionScheduler: PipelineExecutionScheduler,
  ) {}

  listPipelines() {
    return this.pipelineRegistry.list();
  }

  getPromptTemplateForPipeline(pipelineKey: AIPipelineKey) {
    const pipeline = this.pipelineRegistry.getByKey(pipelineKey);
    return this.promptRegistry.getById(pipeline.promptTemplateId);
  }

  renderPromptForPipeline(
    pipelineKey: AIPipelineKey,
    variables: PromptVariables,
  ) {
    const template = this.getPromptTemplateForPipeline(pipelineKey);
    return this.promptRenderer.render(template, variables);
  }

  async queueExecution(
    input: QueueAIExecutionInput,
  ): Promise<ProcessingJobRecord> {
    const pipeline = this.pipelineRegistry.getByKey(input.pipelineKey);
    const template = this.promptRegistry.getById(pipeline.promptTemplateId);

    const execution = await this.executionStore.queueExecution({
      userId: input.userId,
      projectId: input.projectId,
      activityId: input.activityId ?? null,
      uploadMetadataId: input.uploadMetadataId ?? null,
      pipelineKey: pipeline.key,
      jobType: pipeline.jobType,
      datasetContext: input.datasetContext,
      payload: {
        ...input.payload,
        ai: {
          pipelineKey: pipeline.key,
          domain: pipeline.domain,
          promptTemplateId: template.id,
          promptVersion: template.version,
          providerKey: input.providerKey ?? null,
          outputKey: pipeline.outputKey,
          requiredContextKinds: pipeline.requiredContextKinds,
          requestedAt: new Date().toISOString(),
        },
        context: {
          dataset: input.datasetContext ?? null,
          report: input.reportContext ?? null,
          chat: input.chatContext ?? null,
        },
      },
    });

    this.executionScheduler.schedule(execution.id);

    return execution;
  }

  async queueDatasetInterpretation(input: {
    userId: string;
    projectId: string;
    activityId: string;
    uploadMetadataId: string;
    datasetContext: DatasetContext;
  }) {
    return this.queueExecution({
      userId: input.userId,
      projectId: input.projectId,
      activityId: input.activityId,
      uploadMetadataId: input.uploadMetadataId,
      pipelineKey: "interpret_dataset",
      datasetContext: input.datasetContext,
      payload: {
        phase: "queued",
        mocked: true,
      },
    });
  }
}
