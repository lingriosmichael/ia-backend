# OpenAI Call Inventory and Optimization Status

_Last reconciled with the current code: 2026-09-02. Updated same day once
remaining-work items 1 and 2 below were implemented and verified against
the current code (cached-input cost pricing, `reasoningTokens` propagation,
per-run V2 `llmUsage` persistence, and confirmation that the retry
message-ordering claim is code-verified). The production-telemetry
comparisons those two items still call for have not been run — see the
"Still needs measurement" column and the narrowed remaining-work sections
below._

`ia_python_service` is the only service that calls OpenAI directly.
`ia_backend` sends it privacy-safe work and persists results; `ia_webapp`
never calls an LLM.

This is a current-state document, not a history of old plans. "Complete"
means the code exists. It does not mean that production measurements have
proved the expected cost or quality outcome.

## Current inventory

| #   | Product path                         |                                                                    Calls per use | Current model                                    | Important behavior                                                                                                              |
| --- | ------------------------------------ | -------------------------------------------------------------------------------: | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Evidence interpretation              |                                       About 9-13, depending on evidence modality | `gpt-5-mini`                                     | A conditional chain for interpreting an uploaded privacy-safe file. The routing decision happens before dataset classification. |
| 2   | Qualitative coding review            | One codebook proposal per free-text column, then one assignment call per 25 rows | Proposal: `gpt-5-nano`; assignment: `gpt-5-mini` | Uses real privacy-safe excerpts. Assignment failures leave rows uncoded rather than blocking the upload.                        |
| 3   | ActivityAnalystV2 planner            |                         1-5 planning attempts, plus at most one automatic replan | `gpt-5-mini`                                     | Largest prompt. The plan is deterministically checked after every attempt.                                                      |
| 4   | Project Impact Story narrative       |                                                                                1 | `gpt-5-mini`                                     | Produces three grounded narrative paragraphs from outcome evidence and output facts.                                            |
| 5   | Project Impact Story chart authoring |                                                                              1-3 | `gpt-5-mini`                                     | Chooses grounded chart groupings; the backend computes displayed numbers.                                                       |
| 6   | Display-label rewrite                |                                  1 for each previously unseen text/language pair | `gpt-5-nano`                                     | Content-addressed cache; safe shortened-text fallback.                                                                          |
| 7   | Outcome-evidence recommendations     |                                                                              1-3 | `gpt-5-mini`                                     | Suggests evidence/outcome links, then deterministic checks validate identifiers and pairing rules.                              |
| 8   | Legacy dashboard curation            |                                                                              1-3 | `gpt-5-mini`                                     | Retained code, not part of the current product flow.                                                                            |
| 9   | Legacy widget-copy curation          |                                                                              1-2 | `gpt-5-mini`                                     | Retained code, not part of the current product flow.                                                                            |
| 10  | Concern tagging                      |                                                        One call per entity batch | `gpt-5-nano`                                     | Low-complexity classification; errors safely default that batch to unflagged.                                                   |

## What is complete

| Item                                                            | Status             | Evidence in code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Still needs measurement                                                                                                                                        |
| --------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture OpenAI cache-hit tokens                                 | Complete           | `openai_usage.py` reads `prompt_tokens_details.cached_tokens`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cache-hit rate by stage and planning attempt.                                                                                                                  |
| Capture an estimated dollar cost, priced correctly              | Complete           | `llm_pricing.py`'s pricing table is now `(input, cached_input, output)` per model; `estimate_cost_usd` takes `cached_tokens` and bills the uncached remainder at the input rate and the reported cached count at the cached-input rate, clamped so a cached count can never exceed `prompt_tokens`. `openai_usage.py` passes `cached_tokens` through on every call. Unit-tested for uncached, partially cached, fully cached, an over-reported cached count, and an unknown model (`tests/test_llm_pricing.py`).                                                                                                                           | Compare a sample of estimated costs against the OpenAI usage/billing view.                                                                                     |
| Capture and propagate reasoning tokens end to end               | Complete           | Python already recorded `reasoningTokens`/`totalReasoningTokens` (`app/schemas/llm_usage.py`); `ia_backend`'s `LlmUsageCall`/`LlmUsageSummary` contracts, `mergeLlmUsage`, and the one ad-hoc job-payload parser that used to silently drop unknown fields (`interpretationArtifactService.ts`'s `readInterpretationLlmUsage`) now all carry it through. Unit-tested on both sides (`ia_python_service/tests/test_openai_usage.py`, `ia_backend/src/shared/utils/llmUsage.test.ts`, and the existing `interpretationArtifactService.test.ts` ingestion test).                                                                              | Whether reasoning-token volume/cost is material enough on `gpt-5-mini`/`gpt-5-nano` calls to act on.                                                           |
| Persist a per-run `llmUsage` summary on `ActivityAnalysisRunV2` | Complete           | New nullable `llmUsage` field on the Mongo model, persistence types, and Mongo repository mapper; `activityAnalysisV2Service.ts`'s `previewActivityAnalysis` now accumulates usage across every planner call one invocation makes (initial attempt plus any auto-resolved-clarification replan, via `mergeLlmUsage`) and attaches the total to whichever of its seven `.create()` call sites persists the run. Unit-tested that a two-call run persists the _merged_ total, not just the last call's usage. Chosen over "lifetime-ledger-only" for parity with `ProjectAnalyticsSnapshot`, which already persists `llmUsage` the same way. | Whether per-run cost, once visible, changes any planning-budget or model-choice decision.                                                                      |
| Planner retry message order                                     | Complete           | Retry feedback is a third user message after the stable system prompt and evidence packet; `_propose_plan(request, violation_feedback)` reuses the same `request` object across every retry, so the first two messages are provably identical (deterministic `json.dumps` of `_build_planner_payload(request)`), and the feedback is provably the final message. Both claims are unit-tested (`tests/test_activity_analyst_v2.py`'s `test_propose_plan_without_violation_feedback_uses_two_messages` and `test_propose_plan_with_violation_feedback_keeps_prefix_and_appends_third_message`).                                              | Retry cache-hit rate and first-pass/overall plan quality — the code-level claim is now verified, but the cost/quality payoff still needs production telemetry. |
| Quote extraction parallelism                                    | Complete, one path | The qualitative/narrative outcome flow starts quote extraction while semantic/entity/relationship/indicator stages run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | End-to-end worker duration and error handling under real load.                                                                                                 |
| Post-synthesis review consolidation                             | Complete, one path | Qualitative/narrative flow combines confidence, goal alignment, indicator relevance, and clarification questions in one call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Quality versus the old separate judgments.                                                                                                                     |
| Low-cost model settings                                         | Complete           | Display labels, concern tagging, and coding-review code proposals have dedicated `gpt-5-nano` settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Schema validity, quality, latency, and cost in real traffic.                                                                                                   |
| V2 planner observed-value cap                                   | Already protected  | Only categorical/boolean/unknown columns with at most 8 distinct values send `observedValues`; higher-cardinality columns send none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | None before a specific long-value problem is observed.                                                                                                         |

## Known gaps in telemetry

- All three gaps this section used to list — `reasoningTokens` missing from
  the backend contract, the cost estimator overstating cost on a cache hit,
  and the V2 run not persisting its own `llmUsage` — are closed; see "What
  is complete" above. Nothing here is architecturally missing anymore; what
  remains is exclusively production measurement (below).

## Remaining work, ordered by value

### 1. Correct cost accounting and validate telemetry — implementation done, production comparison still open

**Implemented** (2026-09-02)

- `estimate_cost_usd` now takes `cached_tokens`, bills the uncached
  remainder at the input rate and the reported cached count at the
  cached-input rate (clamped to never exceed `prompt_tokens`), and
  `openai_usage.py` passes `cached_tokens` through on every call.
- `reasoningTokens`/`totalReasoningTokens` now flow through backend
  contracts (`LlmUsageCall`/`LlmUsageSummary`), `mergeLlmUsage`, and
  `interpretationArtifactService.ts`'s job-payload parser (the one place
  that read a raw, unvalidated `llmUsage` blob field-by-field and would
  otherwise have silently dropped it).
- Decided: V2 runs persist a full per-run `llmUsage` summary. New nullable
  `llmUsage` field on `ActivityAnalysisRunV2` (model, persistence types,
  Mongo repository); `previewActivityAnalysis` accumulates usage across
  every planner call one invocation makes (via `mergeLlmUsage`) and attaches
  the total to whichever of its `.create()` call sites persists the run —
  chosen for parity with `ProjectAnalyticsSnapshot`, which already persists
  `llmUsage` the same way.

**Tested**

- `estimate_cost_usd`: uncached, partially cached, fully cached, an
  over-reported cached count, and unknown-model, plus an explicit
  partially-cached-must-cost-less-than-uncached regression guard
  (`ia_python_service/tests/test_llm_pricing.py`).
- `summarize_usage_calls`'s `totalReasoningTokens` aggregation, mirroring
  the existing `totalCachedTokens` tests
  (`ia_python_service/tests/test_openai_usage.py`).
- `mergeLlmUsage`'s full field set, including the "null only when neither
  side reported it, a real 0 still counts" distinction for
  `totalReasoningTokens` (new `ia_backend/src/shared/utils/llmUsage.test.ts`
  — no such test existed before).
- Backend ingestion of a raw job payload missing `totalReasoningTokens`/
  `reasoningTokens` defaults to `null` rather than throwing or silently
  keeping stale fallback ternaries (`interpretationArtifactService.test.ts`).
- A two-planner-call V2 run persists the _merged_ `llmUsage` total, not
  just the last call's usage (`activityAnalysisV2Service.test.ts`).

**Still open — needs production data, not more code**

- Compare a sample of estimated costs with the OpenAI usage/billing view.
- Report, per `stageName`: prompt tokens, cached tokens, completion tokens,
  reasoning tokens, latency, and estimated cost. The per-run `llmUsage` on
  `ActivityAnalysisRunV2` and the existing per-call `calls[]` array on every
  `LlmUsageSummary` are what this report would be built from — no new
  capture code is needed, only the query/report itself once there's traffic
  to report on.

### 2. Verify the completed V2 retry cache improvement — code-level claim verified, production comparison still open

The code preserves the stable system-plus-evidence prefix across retry
attempts. This was a safe request-shape change; the code-level ordering
claim itself is now proven by a unit test, but its actual cache-hit/cost/
quality payoff is still an assumption until production telemetry is
reviewed.

**Verified** (2026-09-02) — already implemented as of the prior pass, now
confirmed passing: `tests/test_activity_analyst_v2.py`'s
`test_propose_plan_without_violation_feedback_uses_two_messages` (baseline
attempt is exactly `[system, user]`) and
`test_propose_plan_with_violation_feedback_keeps_prefix_and_appends_third_message`
(a retry's first two messages are asserted equal to the baseline's, and the
retry-feedback message is the third and last). `_propose_plan` reuses the
same `request` object across every retry and builds the evidence-packet
message via a pure, deterministic `json.dumps` of `_build_planner_payload`,
so the "identical prefix" claim is structural, not incidental.

**Still open — needs production data, not more code**

- Compare cache-hit percentage for first attempts versus retry attempts.
- Compare validation-pass rate, number of attempts, latency, and total cost
  per activity before and after the change. The per-run `llmUsage` summary
  from item 1 above (with its per-call `stageName`/`durationMs`/
  `cachedTokens`) is what makes this comparison possible once there's
  traffic to compare.

### 3. Test a larger qualitative-coding assignment batch

The current assignment batch is exactly 25 rows. Each call repeats the
instructions and codebook, so higher batches may reduce call count and cost.
However, excerpts have no length cap today, and one failed large batch affects
more rows.

**Implement only after a bounded test design exists**

- Add a maximum excerpt length before changing batch size.
- Run the same representative privacy-safe data at 25, 50, and 75 rows per
  batch. Do not jump directly to 100.

**Compare**

- Correct code assignments against human-reviewed examples.
- Invalid structured outputs, timeouts, failed batches, latency, prompt and
  output tokens, and cost per successfully assigned row.

### 4. Evaluate the routing tie-breaker on `gpt-5-nano`

This call chooses between `structured_qualitative` and `mixed_dual_track`.
It is a small two-choice classifier, but a wrong decision changes the whole
downstream path. It currently uses the default `OPENAI_MODEL`.

**Implement only after evaluation**

- Add a dedicated routing-tie-breaker model setting, defaulting to the
  current model.
- Build a labeled set of genuinely ambiguous privacy-safe tables.
- Compare `gpt-5-mini` and `gpt-5-nano` on routing accuracy, downstream
  completion, latency, and cost. Switch only if no meaningful regression is
  observed.

### 5. Reduce Project Impact Story narrative catalog detail

The narrative prompt currently renders every catalog entry with its figures.
The grounding guard allows up to 8 cited outcome-catalog entries per
paragraph; it is not a five-entry limit. A long catalog can therefore still
look like a copied data table before the model writes anything.

**Candidate design**

- Send every entry's outcome statement and type so the model can describe
  the full picture.
- Deterministically choose a small, documented set of entries whose detailed
  figures are available for numeric prose; send only plain-language outcome
  statements for the rest.
- Do not describe these as "cited-eligible" entries. Citation happens after
  the request is sent, so the model cannot know it in advance.

**Test before release**

- Add grounded tests for large catalogs: no invented numbers, valid entry
  references, and all important outcomes still represented.
- Blind-review current versus two-tier narratives for readability and loss
  of material information.
- Measure prompt-token reduction and grounding failures.

### 6. Consider one narrow interpretation-pipeline merge: entities plus relationships

This is the strongest call-merge candidate. Relationship detection consumes
only the selected entities and their meanings, which are exactly the entity
stage output. A combined response could return selected entities and the
relationships among them.

**Do not merge the other pairs proposed earlier**

- Do not merge dataset classification with column meanings: routing already
  happens before classification, and the two calls use different evidence.
- Do not broadly merge column meanings with normalization: meanings use
  samples for every column; normalization uses all values and counts only
  for low-cardinality categorical columns. A narrow categorical-only
  experiment is possible later.
- Do not merge indicators with supporting quotes: they share paragraphs,
  but indicators also use entities, relationships, goals, real values, and
  calculation rules. Quote extraction has independent grounding and already
  runs in parallel in one path.
- Do not merge finding creation with review: asking one call to create and
  grade the same finding removes the independent review step.

**Test before release**

- Replay representative privacy-safe inputs through old and combined forms.
- Check entity selection, relationship validity, structured-output failures,
  total tokens, latency, and downstream interpretation quality.

### 7. Align the mixed path with the existing post-synthesis review

The qualitative/narrative path already combines confidence, goal alignment,
indicator relevance, and clarification questions. The mixed path still runs
confidence and clarification-question calls separately after creating
findings. This is a more defensible consolidation target than merging
findings with review.

**Test before release**

- Confirm that the mixed path has all data the combined review requires.
- Compare warnings, confidence, and clarification questions against the
  current path. Preserve the separate finding-creation call.

## Explicit non-actions

- Do not cap V2 `observedValues` further by frequency. The existing maximum
  is 8, and every listed value is used for exact filter grounding and human
  clarification choices. Removing rare values would make valid filters and
  questions unavailable.
- Do not infer cache savings from prompt structure alone. Use reported
  `cachedTokens`; short repeated headers alone may not form a cacheable
  prefix.
- Do not choose between OpenAI and another provider using uncached input
  prices only. Any comparison must include cached-input price, output and
  reasoning-token price, actual retry rate, quality, and latency.

## Current pricing reference

The in-code rates currently used for estimates are per million tokens:

| Model        | Input | Cached input | Output |
| ------------ | ----: | -----------: | -----: |
| `gpt-5-nano` | $0.05 |       $0.005 |  $0.40 |
| `gpt-5-mini` | $0.25 |       $0.025 |  $2.00 |
| `gpt-5`      | $1.25 |       $0.125 | $10.00 |

This table now matches `llm_pricing.py`'s
`_MODEL_PRICING_PER_MILLION_TOKENS_USD` exactly — as of 2026-09-02 the
cached-input column is actually used by `estimatedCostUsd`, not just a
reference value. Update both the table and that dict together from
official OpenAI documentation whenever models or prices change.

## Definition of done for each remaining item

- Code and focused tests are merged.
- The relevant live metric is compared against a baseline.
- Quality and deterministic validation have not regressed.
- The result is either kept with measured evidence or reverted cleanly.
