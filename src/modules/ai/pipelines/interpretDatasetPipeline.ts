import { AIContextService } from "../context/aiContextService.js";
import { AIPromptService } from "../prompts/aiPromptService.js";
import { AIProviderRegistry } from "../providers/providerRegistry.js";
import { AbstractAIProviderPipeline } from "./abstractAiPipeline.js";
import type { AIPipelineDefinition } from "./aiPipeline.js";

export class InterpretDatasetPipeline extends AbstractAIProviderPipeline {
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
