import type { RenderedPromptTemplate } from "../prompts/promptTemplate.js";
import type { AIPipelineKey } from "../aiTypes.js";
import type { AIContextObject } from "../context/aiContextTypes.js";

export interface AIProviderRequest {
  model: string;
  pipelineKey: AIPipelineKey;
  prompt: RenderedPromptTemplate;
  contexts: AIContextObject[];
  responseFormat: "json";
  temperature?: number;
}

export interface AIProviderResponse {
  providerKey: string;
  model: string;
  output: Record<string, unknown>;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export interface AIProvider {
  readonly providerKey: string;
  generateStructuredOutput(request: AIProviderRequest): Promise<AIProviderResponse>;
}
