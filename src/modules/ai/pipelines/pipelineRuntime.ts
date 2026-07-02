import type { AIContextObject, ChatContext, ReportContext } from "../context/aiContextTypes.js";
import type { RenderedPromptTemplate } from "../prompts/promptTemplate.js";
import type { AIProviderResponse } from "../providers/aiProvider.js";
import type { AIPipelineDefinition } from "./aiPipeline.js";

export interface AIPipelineExecutionInput {
  userId: string;
  projectId: string;
  activityId?: string | null;
  uploadMetadataId?: string | null;
  providerKey?: string | null;
  reportContext?: Omit<ReportContext, "kind">;
  chatContext?: Omit<ChatContext, "kind">;
}

export interface AIPipelineExecutionResult {
  pipeline: AIPipelineDefinition;
  contexts: AIContextObject[];
  renderedPrompt: RenderedPromptTemplate;
  providerResponse: AIProviderResponse;
}

export interface AIPipelineRuntime {
  readonly definition: AIPipelineDefinition;
  execute(input: AIPipelineExecutionInput): Promise<AIPipelineExecutionResult>;
}
