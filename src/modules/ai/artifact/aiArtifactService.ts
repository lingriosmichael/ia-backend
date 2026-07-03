import type { ResultRecord } from "../../../shared/contracts.js";
import { AIArtifactRecordService } from "./aiArtifactRecordService.js";
import type { AIContextObject } from "../context/aiContextTypes.js";
import type { AIPipelineDefinition } from "../pipelines/aiPipeline.js";
import type { RenderedPromptTemplate } from "../prompts/promptTemplate.js";
import type { AIProviderResponse } from "../providers/aiProvider.js";

function mapPipelineToResultType(
  pipelineKey: AIPipelineDefinition["key"],
): "semantic_summary" | "activity_snapshot" | "project_snapshot" | "other" {
  if (pipelineKey === "interpret_dataset" || pipelineKey === "review_dataset") {
    return "semantic_summary";
  }

  if (
    pipelineKey === "generate_metrics" ||
    pipelineKey === "generate_dashboard" ||
    pipelineKey === "generate_insights"
  ) {
    return "activity_snapshot";
  }

  if (pipelineKey === "generate_report") {
    return "project_snapshot";
  }

  return "other";
}

export class AIArtifactService {
  constructor(
    private readonly aiArtifactRecordService: AIArtifactRecordService,
  ) {}

  async createPipelineArtifact(input: {
    userId: string;
    projectId: string;
    activityId?: string | null;
    uploadMetadataId?: string | null;
    processingJobId: string;
    pipeline: AIPipelineDefinition;
    renderedPrompt: RenderedPromptTemplate;
    providerResponse: AIProviderResponse;
    contexts: AIContextObject[];
  }): Promise<ResultRecord> {
    return this.aiArtifactRecordService.create(input.userId, input.projectId, {
      activityId: input.activityId ?? null,
      uploadMetadataId: input.uploadMetadataId ?? null,
      processingJobId: input.processingJobId,
      resultType: mapPipelineToResultType(input.pipeline.key),
      payload: {
        pipelineKey: input.pipeline.key,
        domain: input.pipeline.domain,
        outputKey: input.pipeline.outputKey,
        promptTemplateId: input.renderedPrompt.templateId,
        promptVersion: input.renderedPrompt.version,
        providerKey: input.providerResponse.providerKey,
        model: input.providerResponse.model,
        usage: input.providerResponse.usage,
        contexts: input.contexts,
        output: input.providerResponse.output,
      },
    });
  }
}
