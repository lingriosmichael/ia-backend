import { AIContextService } from "../context/ai-context.service.js";
import { AIPromptService } from "../prompts/ai-prompt.service.js";
import { AIProviderRegistry } from "../providers/provider-registry.js";
import { AbstractAIProviderPipeline } from "./abstract-ai-pipeline.js";
import type { AIPipelineDefinition } from "./ai-pipeline.js";

export class GenerateMetricsPipeline extends AbstractAIProviderPipeline {
  constructor(
    definition: AIPipelineDefinition,
    contextService: AIContextService,
    promptService: AIPromptService,
    providerRegistry: AIProviderRegistry,
    defaultProviderKey: string,
    defaultModel: string,
  ) {
    super(
      definition,
      contextService,
      promptService,
      providerRegistry,
      defaultProviderKey,
      defaultModel,
    );
  }
}
