import assert from "node:assert/strict";
import test from "node:test";
import { PythonProcessingClient } from "./pythonProcessingClient.js";

const MIXED_SYNTHESIS_INPUT = {
  datasetProfile: null,
  preparedDataset: {
    evidenceModality: "mixed_dual_track" as const,
    isReadyForDeterministicAnalysis: true,
    unresolvedRequirements: [],
    tables: [],
  },
  deterministicAnalysis: {
    status: "ready" as const,
    metrics: [],
    distributions: [],
    trends: [],
    subgroupBreakdowns: [],
    categoricalCrosstabs: [],
    numericCategorySummaries: [],
    numericCorrelations: [],
    warnings: [],
    candidateIndicators: [],
  },
  qualitativeFindings: [],
  supportingQuotes: [],
  language: "en" as const,
  activityGoals: null,
  projectGoals: null,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function timeoutError(): Error {
  return Object.assign(new Error("The operation was aborted."), {
    name: "TimeoutError",
  });
}

test("synthesizeMixedInterpretation retries once after a timeout and returns the retry's result", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    if (callCount === 1) {
      throw timeoutError();
    }
    return jsonResponse({
      datasetType: "Mixed evidence",
      overallConfidence: 0.5,
      indicators: [],
      warnings: [],
      goalAlignment: [],
    });
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  const result = await client.synthesizeMixedInterpretation(
    MIXED_SYNTHESIS_INPUT,
  );

  assert.equal(callCount, 2);
  assert.equal(result.datasetType, "Mixed evidence");
});

test("synthesizeMixedInterpretation does not retry, and propagates, on a second consecutive timeout", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    throw timeoutError();
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  await assert.rejects(
    () => client.synthesizeMixedInterpretation(MIXED_SYNTHESIS_INPUT),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "python_processing_mixed_synthesis_timeout",
      );
      return true;
    },
  );
  assert.equal(callCount, 2);
});

test("synthesizeMixedInterpretation does not retry a non-timeout failure", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    return new Response("service unavailable", { status: 503 });
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  await assert.rejects(
    () => client.synthesizeMixedInterpretation(MIXED_SYNTHESIS_INPUT),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { code?: string }).code,
        "python_processing_mixed_synthesis_unavailable",
      );
      return true;
    },
  );
  assert.equal(callCount, 1);
});

test("runConcernTagging posts to the concern-tagging endpoint and returns the parsed results", async (t) => {
  let capturedBody: unknown;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse({
      results: [
        { entityKey: "b001", flagged: false, reason: "" },
        {
          entityKey: "b002",
          flagged: true,
          reason: "Mentions wanting to meet alone at home.",
        },
      ],
    });
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  const result = await client.runConcernTagging({
    instruction: "Flag any note suggesting a safety concern.",
    entities: [
      { entityKey: "b001", text: "No concerns noted." },
      { entityKey: "b002", text: "Wants to meet alone at home." },
    ],
    language: "de",
  });

  assert.deepEqual(capturedBody, {
    instruction: "Flag any note suggesting a safety concern.",
    entities: [
      { entityKey: "b001", text: "No concerns noted." },
      { entityKey: "b002", text: "Wants to meet alone at home." },
    ],
    language: "de",
  });
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1]?.flagged, true);
});

test("generateAiKnowledgeSummary uses the extended LLM timeout budget", async (t) => {
  let capturedTimeoutMs: number | null = null;
  t.mock.method(AbortSignal, "timeout", (delay: number) => {
    capturedTimeoutMs = delay;
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({
      summaryText: "## Wirkung\nSummary text.",
    }),
  );

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  const result = await client.generateAiKnowledgeSummary({
    scope: "activity",
    subjectName: "Mentor recruitment",
    insights: [],
    interpretedEvidenceCount: 3,
    language: "de",
    indicators: [],
    contradictions: [],
    coverageIssues: [],
    distributions: [],
    activityGoals: null,
    projectGoals: null,
  });

  assert.equal(capturedTimeoutMs, 120_000);
  assert.equal(result.summaryText, "## Wirkung\nSummary text.");
});
