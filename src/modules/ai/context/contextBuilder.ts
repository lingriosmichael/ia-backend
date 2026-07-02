import type { AIContextKind, AIContextObject } from "./aiContextTypes.js";

export type PromptVariables = Record<string, string>;

export interface ContextBuilder<TContext extends AIContextObject> {
  readonly kind: AIContextKind;
  buildVariables(context: TContext): PromptVariables;
}

export class JsonContextBuilder<TContext extends AIContextObject>
  implements ContextBuilder<TContext>
{
  constructor(readonly kind: AIContextKind) {}

  buildVariables(context: TContext): PromptVariables {
    return {
      context_json: JSON.stringify(context, null, 2),
    };
  }
}
