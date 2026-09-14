import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { DisplayLabelRepository } from "./displayLabelRepository.js";
import type {
  DisplayLabelCreateInput,
  DisplayLabelPersistenceRecord,
} from "./displayLabelPersistence.js";
import { buildDisplayLabelKey } from "./displayLabelPersistence.js";
import { DisplayLabelService } from "./displayLabelService.js";

const NOW = new Date("2026-08-30T10:00:00.000Z");

const noopLogger = {
  warn: () => {},
} as unknown as FastifyBaseLogger;

function fakeUsage(text: string) {
  const totalTokens = text.length;
  return {
    totalCalls: 1,
    totalPromptTokens: totalTokens,
    totalCompletionTokens: 5,
    totalTokens: totalTokens + 5,
    totalCachedTokens: Math.floor(totalTokens / 2),
    totalReasoningTokens: null,
    totalEstimatedCostUsd: totalTokens / 1_000_000,
    calls: [
      {
        stageName: "project_impact_story_display_label",
        model: "test-model",
        promptTokens: totalTokens,
        completionTokens: 5,
        totalTokens: totalTokens + 5,
        durationMs: 1,
        cachedTokens: Math.floor(totalTokens / 2),
        reasoningTokens: null,
        estimatedCostUsd: totalTokens / 1_000_000,
      },
    ],
  };
}

function record(
  sourceText: string,
  displayLabel: string,
): DisplayLabelPersistenceRecord {
  return {
    key: buildDisplayLabelKey(sourceText, "de"),
    sourceText,
    language: "de",
    displayLabel,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createFixture(options?: {
  cached?: DisplayLabelPersistenceRecord[];
  generate?: (text: string) => Promise<string>;
  createImpl?: (
    input: DisplayLabelCreateInput,
    cached: DisplayLabelPersistenceRecord[],
  ) => Promise<DisplayLabelPersistenceRecord>;
}) {
  const cached = [...(options?.cached ?? [])];
  const generateCalls: string[] = [];
  const createCalls: DisplayLabelCreateInput[] = [];

  const displayLabelRepository: DisplayLabelRepository = {
    async findByKeys(keys) {
      return cached.filter((entry) => keys.includes(entry.key));
    },
    async create(input) {
      createCalls.push(input);
      if (options?.createImpl) {
        return options.createImpl(input, cached);
      }
      const created = {
        key: input.key,
        sourceText: input.sourceText,
        language: input.language,
        displayLabel: input.displayLabel,
        createdAt: NOW,
        updatedAt: NOW,
      };
      cached.push(created);
      return created;
    },
  };

  const pythonProcessingClient = {
    async generateDisplayLabel(input: { text: string }) {
      generateCalls.push(input.text);
      const displayLabel = options?.generate
        ? await options.generate(input.text)
        : `short: ${input.text}`;
      return { displayLabel, llmUsage: fakeUsage(input.text) };
    },
  } as unknown as PythonProcessingClient;

  const service = new DisplayLabelService({
    displayLabelRepository,
    pythonProcessingClient,
    logger: noopLogger,
  });

  return { service, generateCalls, createCalls };
}

test("a cached source text is returned without calling Python", async () => {
  const { service, generateCalls } = createFixture({
    cached: [record("Mindestens 70 Bewerbungen sammeln", "70+ Bewerbungen")],
  });

  const result = await service.resolveDisplayLabels(
    ["Mindestens 70 Bewerbungen sammeln"],
    "de",
  );

  assert.equal(
    result.labelsByText.get("Mindestens 70 Bewerbungen sammeln"),
    "70+ Bewerbungen",
  );
  assert.deepEqual(generateCalls, []);
  // Regression: a pure cache hit makes no LLM call, so it must not report
  // any usage — previously untested, since resolveDisplayLabels didn't
  // expose usage at all.
  assert.equal(result.llmUsage, null);
});

test("an uncached source text is generated once and cached", async () => {
  const { service, generateCalls, createCalls } = createFixture();

  const result = await service.resolveDisplayLabels(["Neues Ziel"], "de");

  assert.equal(result.labelsByText.get("Neues Ziel"), "short: Neues Ziel");
  assert.deepEqual(generateCalls, ["Neues Ziel"]);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.displayLabel, "short: Neues Ziel");
  // Regression test for the undercounted-cost bug: Python's per-call
  // llmUsage used to be silently discarded here, so a cold-cache run's
  // real token cost never reached the aggregate usage the project impact
  // story run reports.
  assert.deepEqual(result.llmUsage, fakeUsage("Neues Ziel"));
});

test("usage from multiple cold-cache generations is aggregated into one summary", async () => {
  const { service } = createFixture();

  const result = await service.resolveDisplayLabels(
    ["Erstes Ziel", "Zweites Ziel"],
    "de",
  );

  const first = fakeUsage("Erstes Ziel");
  const second = fakeUsage("Zweites Ziel");
  assert.deepEqual(result.llmUsage, {
    totalCalls: first.totalCalls + second.totalCalls,
    totalPromptTokens: first.totalPromptTokens + second.totalPromptTokens,
    totalCompletionTokens:
      first.totalCompletionTokens + second.totalCompletionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    totalCachedTokens: first.totalCachedTokens + second.totalCachedTokens,
    // Both cold-cache generations left totalReasoningTokens null (fakeUsage
    // never reports it) — mergeLlmUsage's convention keeps the merged
    // result null only when *neither* side reported it, matching here.
    totalReasoningTokens: null,
    totalEstimatedCostUsd:
      first.totalEstimatedCostUsd + second.totalEstimatedCostUsd,
    calls: [...first.calls, ...second.calls],
  });
});

test("duplicate source text in the input is deduped to a single generation call", async () => {
  const { service, generateCalls } = createFixture();

  const result = await service.resolveDisplayLabels(
    ["Wiederholtes Ziel", "Wiederholtes Ziel", "Anderes Ziel"],
    "de",
  );

  assert.equal(generateCalls.length, 2);
  assert.equal(
    result.labelsByText.get("Wiederholtes Ziel"),
    "short: Wiederholtes Ziel",
  );
  assert.equal(result.labelsByText.get("Anderes Ziel"), "short: Anderes Ziel");
});

test("a generation failure falls back to the raw source text instead of throwing", async () => {
  const { service } = createFixture({
    generate: async () => {
      throw new Error("python service unavailable");
    },
  });

  const result = await service.resolveDisplayLabels(["Ziel ohne Label"], "de");

  assert.equal(result.labelsByText.get("Ziel ohne Label"), "Ziel ohne Label");
  // No Python call ever succeeded, so there's nothing to count.
  assert.equal(result.llmUsage, null);
});

test("a duplicate-key race on create falls back to the winning cached record", async () => {
  // The cache is genuinely empty when this request's own findByKeys check
  // runs (so it proceeds to generate, same as any cache miss) — but by the
  // time this request tries to create its own record, a concurrent
  // request has already inserted one under the identical content-
  // addressed key. createImpl simulates that write landing first, then
  // throws the duplicate-key error a real unique-index violation would.
  const { service, createCalls } = createFixture({
    cached: [],
    createImpl: async (_input, cached) => {
      cached.push(record("Ziel im Wettlauf", "Kurzform (Gewinner)"));
      const duplicateKeyError = Object.assign(new Error("E11000"), {
        code: 11000,
      });
      throw duplicateKeyError;
    },
  });

  const result = await service.resolveDisplayLabels(["Ziel im Wettlauf"], "de");

  // The winner's cached label is used, not the losing generation's own
  // response — proves the race-recovery path actually re-fetches rather
  // than silently trusting its own (potentially different) generation.
  assert.equal(
    result.labelsByText.get("Ziel im Wettlauf"),
    "Kurzform (Gewinner)",
  );
  assert.equal(createCalls.length, 1);
  // This request's own Python call still happened and still cost real
  // tokens even though it lost the write race — that cost must still be
  // counted, not dropped along with the losing write.
  assert.deepEqual(result.llmUsage, fakeUsage("Ziel im Wettlauf"));
});
