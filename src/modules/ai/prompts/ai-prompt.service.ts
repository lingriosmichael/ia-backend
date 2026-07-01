import type { AIContextObject } from "../context/ai-context.types.js";
import { JsonContextBuilder } from "../context/context-builder.js";
import type { AIPipelineKey } from "../ai.types.js";
import { PromptRegistry } from "./prompt-registry.js";
import { PromptTemplateRenderer } from "./prompt-template.js";

export class AIPromptService {
  private readonly promptRenderer = new PromptTemplateRenderer();

  constructor(private readonly promptRegistry: PromptRegistry) {}

  renderForPipeline(
    pipelineKey: AIPipelineKey,
    templateId: string,
    contexts: AIContextObject[],
  ) {
    const template = this.promptRegistry.getById(templateId);
    const variables = {
      context_json: JSON.stringify(contexts, null, 2),
      pipeline_key: pipelineKey,
    };

    return this.promptRenderer.render(template, variables);
  }

  renderSingleContext(context: AIContextObject, templateId: string) {
    const template = this.promptRegistry.getById(templateId);
    const builder = new JsonContextBuilder(context.kind);
    return this.promptRenderer.render(template, builder.buildVariables(context));
  }
}
