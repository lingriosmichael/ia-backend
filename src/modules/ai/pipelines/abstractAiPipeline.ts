import type { ChatContext, ReportContext } from "../context/aiContextTypes.js";
import { AIContextService } from "../context/aiContextService.js";
import { AIPromptService } from "../prompts/aiPromptService.js";
import { AIProviderRegistry } from "../providers/providerRegistry.js";
import type {
  AIPipelineExecutionInput,
  AIPipelineExecutionResult,
  AIPipelineRuntime,
} from "./pipelineRuntime.js";
import type { AIPipelineDefinition } from "./aiPipeline.js";

export abstract class AbstractAIProviderPipeline implements AIPipelineRuntime {
  constructor(
    readonly definition: AIPipelineDefinition,
    private readonly contextService: AIContextService,
    private readonly promptService: AIPromptService,
    private readonly providerRegistry: AIProviderRegistry,
    private readonly defaultProviderKey: string,
    private readonly defaultModel: string,
  ) {}

  async execute(
    input: AIPipelineExecutionInput,
  ): Promise<AIPipelineExecutionResult> {
    const contexts = await this.contextService.buildExecutionContexts({
      userId: input.userId,
      projectId: input.projectId,
      activityId: input.activityId,
      uploadMetadataId: input.uploadMetadataId,
      requiredContextKinds: this.definition.requiredContextKinds,
      reportContext: this.buildReportContext(input.reportContext),
      chatContext: this.buildChatContext(input.chatContext),
    });

    const renderedPrompt = this.promptService.renderForPipeline(
      this.definition.key,
      this.definition.promptTemplateId,
      contexts,
    );

    const provider = this.providerRegistry.getProvider(
      input.providerKey ?? this.defaultProviderKey,
    );
    const providerResponse = await provider.generateStructuredOutput({
      model: this.defaultModel,
      pipelineKey: this.definition.key,
      prompt: renderedPrompt,
      contexts,
      responseFormat: "json",
    });

    return {
      pipeline: this.definition,
      contexts,
      renderedPrompt,
      providerResponse,
    };
  }

  protected buildReportContext(
    context: Omit<ReportContext, "kind"> | undefined,
  ) {
    return context;
  }

  protected buildChatContext(context: Omit<ChatContext, "kind"> | undefined) {
    return context;
  }
}
