import type { LlmUsageSummary } from "../contracts.js";

export function mergeLlmUsage(
  first: LlmUsageSummary | null,
  second: LlmUsageSummary | null,
): LlmUsageSummary | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return {
    totalCalls: first.totalCalls + second.totalCalls,
    totalPromptTokens: first.totalPromptTokens + second.totalPromptTokens,
    totalCompletionTokens:
      first.totalCompletionTokens + second.totalCompletionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    calls: [...first.calls, ...second.calls],
  };
}
