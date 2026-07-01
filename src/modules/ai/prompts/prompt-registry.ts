import { AppError } from "../../../shared/errors/app-error.js";
import type { AIDomain, AIPipelineKey } from "../ai.types.js";
import type { PromptTemplate } from "./prompt-template.js";

export class PromptRegistry {
  private readonly templatesById: Map<string, PromptTemplate>;

  constructor(templates: PromptTemplate[]) {
    this.templatesById = new Map(templates.map((template) => [template.id, template]));
  }

  getById(templateId: string): PromptTemplate {
    const template = this.templatesById.get(templateId);

    if (!template) {
      throw new AppError(
        `Prompt template "${templateId}" is not registered.`,
        500,
        "prompt_template_not_found",
      );
    }

    return template;
  }

  list(): PromptTemplate[] {
    return [...this.templatesById.values()];
  }

  listByDomain(domain: AIDomain): PromptTemplate[] {
    return this.list().filter((template) => template.domain === domain);
  }

  findByPipelineKey(pipelineKey: AIPipelineKey): PromptTemplate | null {
    return (
      this.list().find((template) => template.pipelineKey === pipelineKey) ?? null
    );
  }
}
