import type { AIDomain, AIPipelineKey } from "../aiTypes.js";
import type { PromptVariables } from "../context/contextBuilder.js";

export interface PromptTemplate {
  id: string;
  domain: AIDomain;
  pipelineKey: AIPipelineKey;
  version: string;
  systemPrompt: string;
  userPrompt: string;
  requiredVariables: string[];
}

export interface RenderedPromptTemplate {
  templateId: string;
  version: string;
  systemPrompt: string;
  userPrompt: string;
}

function replaceVariables(
  template: string,
  variables: PromptVariables,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, variableName) => {
      return variables[variableName] ?? "";
    },
  );
}

export class PromptTemplateRenderer {
  render(
    template: PromptTemplate,
    variables: PromptVariables,
  ): RenderedPromptTemplate {
    for (const variableName of template.requiredVariables) {
      if (!(variableName in variables)) {
        throw new Error(
          `Prompt variable "${variableName}" is required for template "${template.id}".`,
        );
      }
    }

    return {
      templateId: template.id,
      version: template.version,
      systemPrompt: replaceVariables(template.systemPrompt, variables),
      userPrompt: replaceVariables(template.userPrompt, variables),
    };
  }
}
