import type { AIContextObject } from "../context/aiContextTypes.js";
import { JsonContextBuilder } from "../context/contextBuilder.js";
import type { AIPipelineKey } from "../aiTypes.js";
import { PromptRegistry } from "./promptRegistry.js";
import { PromptTemplateRenderer } from "./promptTemplate.js";

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
