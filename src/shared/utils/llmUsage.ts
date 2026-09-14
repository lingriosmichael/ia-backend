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
    totalCachedTokens:
      first.totalCachedTokens === null && second.totalCachedTokens === null
        ? null
        : (first.totalCachedTokens ?? 0) + (second.totalCachedTokens ?? 0),
    totalReasoningTokens:
      first.totalReasoningTokens === null &&
      second.totalReasoningTokens === null
        ? null
        : (first.totalReasoningTokens ?? 0) +
          (second.totalReasoningTokens ?? 0),
    totalEstimatedCostUsd:
      first.totalEstimatedCostUsd === null ||
      second.totalEstimatedCostUsd === null
        ? null
        : first.totalEstimatedCostUsd + second.totalEstimatedCostUsd,
    calls: [...first.calls, ...second.calls],
  };
}
