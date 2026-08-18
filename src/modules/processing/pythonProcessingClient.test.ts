import assert from "node:assert/strict";
import test from "node:test";
import { PythonProcessingClient } from "./pythonProcessingClient.js";
import { AppError } from "../../shared/errors/appError.js";

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

test("planActivityAnalysisV2 posts to the dedicated planner endpoint and uses its own dedicated background-job timeout budget", async (t) => {
  let capturedTimeoutMs: number | null = null;
  let capturedUrl = "";
  let capturedBody: unknown;
  t.mock.method(AbortSignal, "timeout", (delay: number) => {
    capturedTimeoutMs = delay;
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse({
      goalPlans: [],
      toolRequests: [],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    });
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  const result = await client.planActivityAnalysisV2({
    activityId: "activity-1",
    activityName: "Mentor:innengewinnung und Auswahl",
    language: "de",
    goals: [
      {
        goalId: "output_1",
        goalType: "output",
        goalText: "Mindestens 70 Bewerbungen sammeln",
        targetNumber: 70,
      },
    ],
    evidenceTables: [
      {
        uploadMetadataId: "upload-1",
        originalFileName: "bewerbungen.csv",
        evidenceModality: "structured_quantitative",
        tableName: "bewerbungen",
        rowCount: 75,
        identifierColumn: "bewerbungs_id",
        identifierHandling: "deduplicate_by_identifier",
        primaryStatusColumn: "status",
        primaryDateColumn: null,
        columns: [
          {
            name: "bewerbungs_id",
            role: "identifier",
            inferredType: "identifier",
          },
        ],
      },
    ],
    runLimits: {
      maxToolCalls: 8,
      maxLlmIterations: 2,
      timeoutMs: 30_000,
      maxEvidenceItems: 10,
    },
    planningTimeBudgetMs: 270_000,
  });

  assert.equal(
    capturedUrl,
    "https://python.example/internal/interpretation/activity-analysis-v2-plan",
  );
  assert.deepEqual(capturedBody, {
    activityId: "activity-1",
    activityName: "Mentor:innengewinnung und Auswahl",
    language: "de",
    goals: [
      {
        goalId: "output_1",
        goalType: "output",
        goalText: "Mindestens 70 Bewerbungen sammeln",
        targetNumber: 70,
      },
    ],
    evidenceTables: [
      {
        uploadMetadataId: "upload-1",
        originalFileName: "bewerbungen.csv",
        evidenceModality: "structured_quantitative",
        tableName: "bewerbungen",
        rowCount: 75,
        identifierColumn: "bewerbungs_id",
        identifierHandling: "deduplicate_by_identifier",
        primaryStatusColumn: "status",
        primaryDateColumn: null,
        columns: [
          {
            name: "bewerbungs_id",
            role: "identifier",
            inferredType: "identifier",
          },
        ],
      },
    ],
    runLimits: {
      maxToolCalls: 8,
      maxLlmIterations: 2,
      timeoutMs: 30_000,
      maxEvidenceItems: 10,
    },
    planningTimeBudgetMs: 270_000,
  });
  // Uses the planner's own dedicated timeout, not the generic llmTimeoutMs
  // passed to the constructor (120_000 above) — confirms the two ceilings
  // are independent now that the planner runs in a background job.
  assert.equal(capturedTimeoutMs, 300_000);
  assert.equal(result.validation.status, "passed");
});

test("planActivityAnalysisV2 accepts clarificationQuestions using the epistemicRole question codes", async (t) => {
  // Regression test: the planner's InterpretationQuestionDraft schema
  // (Python) and contracts.ts's interpretationQuestionCodeValues both
  // include epistemic_role_clarification/validated_scale_confirmation,
  // but this client's Zod schema was hand-duplicated and never updated to
  // match — a real plan response carrying either code was rejected as
  // malformed even though it was perfectly valid.
  t.mock.method(AbortSignal, "timeout", () => new AbortController().signal);
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({
      goalPlans: [],
      toolRequests: [],
      clarificationQuestions: [
        {
          goalId: null,
          prompt: "Ist 'confidence_code' eine validierte Skala?",
          kind: "single_choice",
          questionDomain: "preparation",
          options: ["Ja", "Nein"],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "validated_scale_confirmation",
          targetTableName: "mentor_feedback",
          targetColumnName: "confidence_code",
        },
        {
          goalId: null,
          prompt: "Was steht in der Spalte 'theme_code'?",
          kind: "single_choice",
          questionDomain: "preparation",
          options: [
            "Feste Auswahlwerte",
            "Freie Texte",
            "Einschätzung durch eine Person",
            "Etwas anderes",
          ],
          recommendedOption: null,
          recommendedConfidence: null,
          isBlocking: true,
          questionCode: "epistemic_role_clarification",
          targetTableName: "mentor_feedback",
          targetColumnName: "theme_code",
        },
      ],
      limitations: [],
      validation: {
        status: "passed",
        issues: [],
      },
    }),
  );

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  const result = await client.planActivityAnalysisV2({
    activityId: "activity-1",
    activityName: "Mentoring-Reflexion",
    language: "de",
    goals: [],
    evidenceTables: [],
    runLimits: {
      maxToolCalls: 8,
      maxLlmIterations: 2,
      timeoutMs: 30_000,
      maxEvidenceItems: 10,
    },
    planningTimeBudgetMs: 270_000,
  });

  assert.equal(result.validation.status, "passed");
  assert.equal(result.clarificationQuestions?.length, 2);
  assert.equal(
    result.clarificationQuestions?.[0]?.questionCode,
    "validated_scale_confirmation",
  );
  assert.equal(
    result.clarificationQuestions?.[1]?.questionCode,
    "epistemic_role_clarification",
  );
});

test("planActivityAnalysisV2 rejects a malformed plan response instead of trusting it", async (t) => {
  t.mock.method(AbortSignal, "timeout", () => new AbortController().signal);
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({
      goalPlans: [],
      // toolRequests[0].toolName is not a real tool — a hallucinated or
      // corrupted planner response must be rejected here rather than
      // reaching the deterministic tool executor, which has no catch-all
      // for an unrecognized tool name.
      toolRequests: [
        {
          goalId: "output_1",
          toolName: "definitely_not_a_real_tool",
          arguments: {},
        },
      ],
      limitations: [],
      validation: { status: "passed", issues: [] },
    }),
  );

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  await assert.rejects(
    () =>
      client.planActivityAnalysisV2({
        activityId: "activity-1",
        activityName: "Mentor:innengewinnung und Auswahl",
        language: "de",
        goals: [
          {
            goalId: "output_1",
            goalType: "output",
            goalText: "Mindestens 70 Bewerbungen sammeln",
            targetNumber: 70,
          },
        ],
        evidenceTables: [],
        runLimits: {
          maxToolCalls: 8,
          maxLlmIterations: 2,
          timeoutMs: 30_000,
          maxEvidenceItems: 10,
        },
        planningTimeBudgetMs: 270_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(
        error.code,
        "python_processing_activity_analysis_v2_plan_malformed",
      );
      return true;
    },
  );
});

test("planActivityAnalysisV2 preserves upstream failure details for debugging", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return new Response('{"detail":"Not Found"}', {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
    });
  });

  const client = new PythonProcessingClient(
    "https://python.example",
    "secret",
    30_000,
    120_000,
  );

  await assert.rejects(
    () =>
      client.planActivityAnalysisV2({
        activityId: "activity-1",
        activityName: "Mentor:innengewinnung und Auswahl",
        language: "de",
        goals: [],
        evidenceTables: [],
        runLimits: {
          maxToolCalls: 8,
          maxLlmIterations: 2,
          timeoutMs: 30_000,
          maxEvidenceItems: 10,
        },
        planningTimeBudgetMs: 270_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(
        error.code,
        "python_processing_activity_analysis_v2_plan_unavailable",
      );
      assert.deepEqual(error.details, {
        url: "https://python.example/internal/interpretation/activity-analysis-v2-plan",
        path: "/internal/interpretation/activity-analysis-v2-plan",
        method: "POST",
        timeoutMs: 300_000,
        upstreamStatus: 404,
        upstreamStatusText: "Not Found",
        upstreamBody: '{"detail":"Not Found"}',
      });
      return true;
    },
  );
});
