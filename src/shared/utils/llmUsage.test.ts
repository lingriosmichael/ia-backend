import assert from "node:assert/strict";
import test from "node:test";
import type { LlmUsageSummary } from "../contracts.js";
import { mergeLlmUsage } from "./llmUsage.js";

function buildUsage(overrides: Partial<LlmUsageSummary>): LlmUsageSummary {
  return {
    totalCalls: 1,
    totalPromptTokens: 100,
    totalCompletionTokens: 20,
    totalTokens: 120,
    totalCachedTokens: null,
    totalReasoningTokens: null,
    totalEstimatedCostUsd: null,
    calls: [],
    ...overrides,
  };
}

test("mergeLlmUsage returns whichever side is non-null when the other is null", () => {
  const usage = buildUsage({});
  assert.equal(mergeLlmUsage(null, usage), usage);
  assert.equal(mergeLlmUsage(usage, null), usage);
  assert.equal(mergeLlmUsage(null, null), null);
});

test("mergeLlmUsage sums every numeric field and concatenates calls", () => {
  const first = buildUsage({
    totalCalls: 1,
    totalPromptTokens: 100,
    totalCompletionTokens: 20,
    totalTokens: 120,
    totalCachedTokens: 10,
    totalReasoningTokens: 5,
    totalEstimatedCostUsd: 0.001,
    calls: [
      {
        stageName: "stage_1",
        model: "gpt-5-mini",
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        durationMs: 500,
        cachedTokens: 10,
        reasoningTokens: 5,
        estimatedCostUsd: 0.001,
      },
    ],
  });
  const second = buildUsage({
    totalCalls: 1,
    totalPromptTokens: 50,
    totalCompletionTokens: 10,
    totalTokens: 60,
    totalCachedTokens: 5,
    totalReasoningTokens: 2,
    totalEstimatedCostUsd: 0.0005,
    calls: [
      {
        stageName: "stage_2",
        model: "gpt-5-mini",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
        durationMs: 300,
        cachedTokens: 5,
        reasoningTokens: 2,
        estimatedCostUsd: 0.0005,
      },
    ],
  });

  const merged = mergeLlmUsage(first, second);

  assert.deepEqual(merged, {
    totalCalls: 2,
    totalPromptTokens: 150,
    totalCompletionTokens: 30,
    totalTokens: 180,
    totalCachedTokens: 15,
    totalReasoningTokens: 7,
    totalEstimatedCostUsd: 0.0015,
    calls: [...first.calls, ...second.calls],
  });
});

test("mergeLlmUsage keeps totalReasoningTokens null only when neither side reported it — a real 0 from one side still counts", () => {
  const neitherReported = mergeLlmUsage(
    buildUsage({ totalReasoningTokens: null }),
    buildUsage({ totalReasoningTokens: null }),
  );
  assert.equal(neitherReported?.totalReasoningTokens, null);

  const oneReportedZero = mergeLlmUsage(
    buildUsage({ totalReasoningTokens: 0 }),
    buildUsage({ totalReasoningTokens: null }),
  );
  assert.equal(oneReportedZero?.totalReasoningTokens, 0);

  const bothReported = mergeLlmUsage(
    buildUsage({ totalReasoningTokens: 3 }),
    buildUsage({ totalReasoningTokens: 4 }),
  );
  assert.equal(bothReported?.totalReasoningTokens, 7);
});

test("mergeLlmUsage's totalCachedTokens null convention is unchanged by the reasoningTokens addition", () => {
  const merged = mergeLlmUsage(
    buildUsage({ totalCachedTokens: null }),
    buildUsage({ totalCachedTokens: null }),
  );
  assert.equal(merged?.totalCachedTokens, null);
});

test("mergeLlmUsage's totalEstimatedCostUsd is null if either side is null, even when both totalReasoningTokens are known", () => {
  const merged = mergeLlmUsage(
    buildUsage({ totalReasoningTokens: 3, totalEstimatedCostUsd: 0.001 }),
    buildUsage({ totalReasoningTokens: 4, totalEstimatedCostUsd: null }),
  );
  assert.equal(merged?.totalEstimatedCostUsd, null);
  assert.equal(merged?.totalReasoningTokens, 7);
});
