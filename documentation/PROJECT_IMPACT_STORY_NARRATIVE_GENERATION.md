# Project Impact Story — Narrative Generation Deep Dive

Scope note: this file is a narrow, mechanism-level reference for exactly
one part of the Project Impact Story feature — the "Fortschritt & Wirkung"
narrative text (the LLM call, its full prompt, and the deterministic
checker that grounds its output). It exists alongside, not instead of,
`CURRENT_ANALYTICS_PIPELINE.md` (this directory), which is the canonical
architecture map for the whole feature (routing, staleness, chart
selection, snapshot/overlay persistence, etc.) — read that first for
context; this file goes one level deeper on the single narrative call and
was written by re-deriving every claim below directly from on-disk source
(file + line references throughout), not from that doc's own summary. If
this file and `CURRENT_ANALYTICS_PIPELINE.md` ever disagree on the
narrative call specifically, prefer this file and fix the other — see
"Known discrepancy fixed" at the bottom. Its sibling,
`PROJECT_IMPACT_STORY_CHART_SELECTION_GENERATION.md` (this directory),
does the same deep-dive treatment for the _other_ LLM call this feature
makes — chart/KPI selection — which this file does not cover.

Everything below reflects source as read on 2026-08-28.

## 1. What triggers generation

**UI surface**: the "Fortschritt & Wirkung" card
(`ia_webapp/src/components/impactStory/impactStoryNarrativeBanner.tsx`),
rendered inside `projectImpactStoryPage.tsx` on the project's Analytics tab
(`routes/projects/$projectId/analytics.tsx`).

**Two ways it runs**:

- **Fetch-on-load** (no LLM call): `useProjectAnalyticsQuery(projectId)`
  (`ia_webapp/src/hooks/useWorkspaceQueries.ts:415-421`) →
  `GET /projects/:projectId/analytics` → returns the _already-generated_
  latest story. Opening the tab never triggers a new LLM call by itself.
- **"Analyse aktualisieren" click** (full regeneration):
  `useRunProjectAnalyticsMutation(projectId)` → `POST
/projects/:projectId/analytics`. This is the only user action that
  produces a new narrative.

## 2. Call chain for a regeneration, in order

1. **Route**: `POST /projects/:projectId/analytics`
   (`ia_backend/src/modules/projectImpactStory/projectImpactStoryRoutes.ts:10-17`),
   rate-limited to 12 kickoff requests / authenticated user / 10 minutes
   (`processingKickoffRateLimitConfig`,
   `ia_backend/src/shared/http/rateLimitConfigs.ts:27-29`). Also reachable
   as `POST /projects/:projectId/impact-story` — same controller method,
   not a second implementation
   (`projectImpactStoryController.ts:16-18`).
2. **Controller**: `ProjectImpactStoryController.triggerProjectAnalyticsRun`
   (`projectImpactStoryController.ts:20-67`):
   - synchronously runs `assertReadyForProjectAnalyticsRun` — a fast 409 if
     the project has no activities or nothing groundable yet, so a doomed
     request never becomes a job;
   - checks for an already-running `project_impact_story` job for this
     project (`processingJobService.findActiveByProjectAndType`) and
     **returns that job instead of creating a new one** if found — the
     comment at lines 37-47 explains why: a run can take upwards of ten
     minutes of real LLM latency, and the frontend's only record of "a run
     is in flight" is page-local state a tab switch discards, so without
     this a stale-looking button click would start a redundant concurrent
     run;
   - otherwise creates a `processingJobService` record
     (`jobType: "project_impact_story"`) and returns it immediately. The
     route itself never calls Python — only the background worker does.
3. **Worker**: `ia_backend/src/workers/activityAnalysisWorker.ts` — a
   separate deployed process (`npm run start:activity-analysis-worker`)
   that polls for claimable jobs. It also claims `activity_analysis_v2` and
   `qualitative_coding_review` jobs; `project_impact_story` is a third
   `jobType` on the same `ai_executions` queue. On claiming this job type it
   calls `ProjectImpactStoryService.buildProjectImpactStory(...)`.
4. **Service** — `ProjectImpactStoryService.buildProjectImpactStory`
   (`ia_backend/src/modules/projectImpactStory/projectImpactStoryService.ts:733-907`):
   1. re-validates readiness (state can drift between enqueue and claim);
   2. builds the **chart-plan catalog** from every activity's grounded
      `ActivityAnalystV2` output (`projectImpactStoryCatalog.ts`) — this
      feeds headline KPIs / charts, **not** the narrative;
   3. builds the **impact catalog** exclusively from human-confirmed
      `OutcomeEvidenceLink` records
      (`projectImpactStoryImpactCatalog.ts` → `buildProjectImpactStoryImpactCatalog`)
      — this is the **only** catalog ever sent to the narrative LLM call;
   4. `planChartsAndKpis` → `pythonProcessingClient.planProjectImpactStoryChart`
      → `POST /internal/project-impact-story/chart-plan` (chart/KPI
      selection only — no numbers computed by Python; irrelevant to the
      narrative text itself, listed here only to place the narrative call
      in sequence);
   5. persists a `project_analytics_snapshots` document;
   6. **if `impactCatalog.length === 0`, stops here** — no narrative call,
      no overlay document, `story.narrativeSummary` stays `null`
      (`buildProjectImpactStory`, the `impactCatalog.length > 0` guard
      around step 7 below);
   7. otherwise calls `generateNarrative` (`projectImpactStoryService.ts:542-621`)
      → `pythonProcessingClient.generateProjectImpactStoryNarrative`
      (`ia_backend/src/modules/processing/pythonProcessingClient.ts:1538-1570`)
      → `POST {PYTHON_SERVICE_URL}/internal/project-impact-story/narrative`,
      authenticated with a shared-secret header
      (`x-internal-service-token`, `authHeaders()` at line 1216-1218),
      timeout `projectImpactStoryLlmTimeoutMs = 300_000` ms (line 1214);
   8. persists a `project_impact_stories` overlay document referencing the
      snapshot's id, or — if the whole HTTP call throws (network error,
      timeout, malformed response) — persists an overlay anyway with a
      **backend-local, non-LLM fallback narrative** and
      `narrativeStatus: "call_failed"` (`buildProjectImpactStory`'s
      `catch` block, `projectImpactStoryService.ts:884-906`; the fallback
      builder is `buildImpactCatalogFallbackNarrativeSummary`, §7 below).

**No LLM/Anthropic/OpenAI SDK is ever instantiated inside `ia_backend`.**
Every LLM call in this feature happens inside `ia_python_service`;
`ia_backend` only makes a plain authenticated `fetch` via
`PythonProcessingClient`.

5. **Read path**: `GET /projects/:projectId/analytics` →
   `ProjectImpactStoryController.getLatestProjectAnalytics` →
   `ProjectImpactStoryService.getLatestForProject`
   (`projectImpactStoryService.ts:935-989`) — loads the latest snapshot,
   the latest overlay (used only if `overlay.analyticsSnapshotId` matches
   the snapshot's id), computes staleness (§8), and returns
   `{ story, isStale }`. No LLM call happens on read.

## 3. The LLM call itself

**Route**: `POST /internal/project-impact-story/narrative` →
`ia_python_service/app/api/routes.py:162-169` →
`generate_project_impact_story_narrative` in
`ia_python_service/app/project_impact_story/narrative.py`. Guarded by
`require_internal_service_token` (the same shared-secret header
`ia_backend` sends).

**Client / model**: raw `openai.AsyncOpenAI`
(`ia_python_service/app/core/openai_client.py:1-11`, `@lru_cache`-cached,
one instance per process) — **not** an Anthropic client, despite the rest
of this codebase's Claude-authored tooling; this is a deliberate,
independent architectural choice already made in this repo. Model:
`Settings.openai_model`, default `"gpt-5-mini"`
(`ia_python_service/app/core/config.py:26-27`), configurable via env var,
never hardcoded per call site.

**How it's called** — `parse_structured_chat_completion`
(`ia_python_service/app/core/openai_usage.py:66-118`), via
`client.beta.chat.completions.parse(...)`: structured JSON output
(`response_format=ProjectImpactStoryNarrativeDraft`, a Pydantic model — not
free text), `temperature=0, seed=0` as requested, but **actually forced to
`temperature=1`** at call time because `gpt-5-mini` is a reasoning-family
model (`gpt-5`/`o1`/`o3`/`o4` prefixes) that rejects any other value — a
real 400 from the API was hit and documented in a comment at
`openai_usage.py:20-25` the first time this service pointed at
`gpt-5-mini`. `seed=0` is still passed as requested but is not a
determinism guarantee once temperature is forced away from 0.

## 4. The full, verbatim system prompt

Source: `_propose_narrative`,
`ia_python_service/app/project_impact_story/narrative.py:199-345`. This is
the literal string the code concatenates (only relevant single-quote/
paraphrase-marker formatting normalized for Markdown readability — no
wording changed):

> You write the user-facing lead narrative for an NGO impact dashboard. The audience is non-technical project staff and project managers who want to quickly understand what changed for people, what they experienced, and what the project seems to have moved. Write in clear, direct everyday language. Prefer short sentences, concrete interpretation, and human meaning over dense measurement wording. This must read like an accessible impact summary, not like a monitoring note or a data table. Use numbers sparingly: only keep the few figures that materially orient the reader. If a point can be understood without a number, prefer the plain-language version.
>
> You are given up to three sources: an optional starting-situation description (the problem/context before the project began, as the organization itself describes it), OUTPUT_FACT entries (what the project did — activities run, people reached, things produced), and an outcome catalog with three kinds of entries: PAIRED_DELTA is a real measured before/after change (the same matched respondents, measured twice) — this is the only entry type you may describe as something that changed over time. DISTRIBUTION is a single snapshot at one point in time, not a measured change — even if two DISTRIBUTION entries share an outcome and look like a before/after pair, they are not linked as one, so describe each as what it shows now, never as something that increased, decreased, improved, or shifted. UNMEASURED means no evidence is linked yet. Tell the story of all three: where things stood before, what the project did, and what the confirmed evidence shows now.
>
> Return `narrative`, a list of exactly 3 paragraph objects, each with `text` and `referencedEntryIds`, forming one connected story — never a sequence of isolated one-sentence-per-entry statements ("For X, Y changed. For Z, W changed."). Give each paragraph a distinct role:
>
> 1. Starting situation & activities — if a starting-situation description is given in the project context, open with one or two sentences paraphrasing that problem/context in your own words (a scene-setter, not a quote) — this frames everything that follows as a response to that situation. Then describe what the project actually did: reach, scale, completion, drawing only on OUTPUT_FACT entries. Purely descriptive ("X applications were received, Y people were trained, Z were formed") — never claim or imply this caused any outcome; that link belongs to paragraph 3, not here. If no starting-situation description is given and there are no OUTPUT_FACT entries either, skip this role and open directly with outcome scene-setting instead (cite one real count already on an outcome entry, e.g. nMatched/nBaseline/n, if the catalog has one).
> 2. Outcomes — characterize the overall pattern the outcome catalog shows, the way you'd explain it to a busy project lead who will never look at the raw data. Focus first on what people seem to have experienced: for example whether they felt more connected, less connected, more confident, more isolated, more aware of local offers, or under more strain. Name those experiences plainly instead of hiding behind research jargon. Choose at most 5 entries total in this paragraph — the strongest signal, the largest group, or the most central to what the project set out to do — and cite only the few real numbers that truly help the reader understand the scale or direction. This limit is enforced automatically: a paragraph citing more than 5 entries will be rejected and you will be asked to redo it, so choose deliberately rather than naming everything. For every other outcome-catalog entry, describe it only thematically, in your own words, with no number attached at all. Group by what entries share (the same population, the same theme) using connecting language ("similarly", "alongside this", "meanwhile") rather than restating each entry in isolation. If entries span more than one group of people (e.g. program participants and staff or volunteers), address each group in its own sentence or two rather than interleaving them. When you do cite a DISTRIBUTION entry, describe the overall pattern in words ("most respondents said yes", "opinions were about evenly split between X and Y") or as a percentage of respondents — never as a bare list of every share's count (never write anything shaped like "A=12, B=8, C=3"); a reader should never be able to tell you were copying from a data table. Avoid technical phrases such as "Indikatoren", "matched pairs", "Baseline-Befragte", "Outcome-Messung", or "PAIRED_DELTA"; translate them into natural user-facing language.
> 3. Closing — step back and characterize what this body of evidence says about the project's impact so far relative to where things started. Prioritize meaning over catalog bookkeeping: what picture emerges overall, what seems encouraging or concerning, and what should a project team take away from this now. Mention the breadth of what was observed only lightly, and only if it helps the reader. If UNMEASURED entries exist, mention them briefly as open questions or areas where the project still lacks clear evidence. If every outcome-catalog entry is DISTRIBUTION (no PAIRED_DELTA entries at all), do not claim the evidence shows change, improvement, or movement — describe it as a first/current picture against that starting point instead, since nothing in the catalog actually measures a before/after difference. If a starting-situation description was given, this is the paragraph that closes the loop back to it ("against that starting point, ..."). You may connect the activities and outcomes halves here ("alongside this activity, participants also reported...") but never with causal language — activity and outcome are still two separately observed facts, not a proven cause and effect. This should read as a takeaway, not a third repetition of the same numbers.
>
> If a source has very little to say (one or two entries, no OUTPUT_FACT entries at all, no starting-situation description, or every outcome entry is UNMEASURED), keep the affected paragraph short and it is fine for it to be brief, but never pad with repeated phrasing or invented elaboration to fill space — a true takeaway from thin evidence is still a real takeaway.
>
> The starting-situation description is context for framing only — it is not a grounded data source. Paraphrase its substance freely, but never restate a number from it as if it were a measured value, and never invent a number to characterize how big or widespread it was.
>
> Every entryId you reference must be copied exactly from the OUTPUT_FACT list or the outcome catalog below — never invent one, never reference one not shown to you. When you write a number, it must be one of the real values already present on an entry you reference in that paragraph's referencedEntryIds — restate it exactly as given, never rounded, recalculated, or combined with another entry's numbers. A PAIRED_DELTA entry's before/after values are already averages across matched respondents — describe the change, do not recompute it. A DISTRIBUTION entry's shares are already final counts, but restating one as a percentage of the entry's n instead of its raw count is encouraged when it reads more naturally — the exact computed percentage (share divided by n) is automatically grounded, so this is always safe as long as you compute it correctly from the real count and n shown for that entry; just never invent a percentage that doesn't match that computation. A DISTRIBUTION entry's share labels are sometimes rating-scale points themselves (e.g. shares labeled 1 through 5) — citing a scale-point label as a number (e.g. "most respondents rated it 4 or 5") is fine and is not the same as inventing a count. An OUTPUT_FACT's value is already final — restate it exactly as shown, including its existing % sign if it has one. Never use causal language anywhere (caused, led to, resulted in, because of, due to, as a result of, thanks to) — use only observational language: describe what happened and what changed, never why or because of what. Frame both halves as real progress and results, but never as a target being met, exceeded, or missed, and never with language such as "Ziel erreicht", "verfehlt", "übertroffen", or a percentage-of-target — targets are not part of either source. For an UNMEASURED entry, you may mention that no evidence is linked yet, but never invent a number for it. `referencedEntryIds` is the only place an entryId ever appears — `text` is prose a project team or external reader reads, never a citation list. Never write an entryId's literal value (it looks like a UUID, e.g. '2ca56c95-2389-4cfa-9a97-8e47c82b8caf') inside `text`, in parentheses or otherwise — a reader must never see one. No bullet list. No markdown heading. No table. No mention of JSON, catalog entries, entryId, or being an AI.

Appended verbatim after the block above, always:

```
\n\n{language instruction}
```

where `_language_instruction` (`narrative.py:20-22`) is:

```python
def _language_instruction(language: str) -> str:
    language_name = language_display_name(language)
    return f"Write every user-facing sentence in {language_name}. Do not mix languages."
```

— which for the screenshot's German output resolves to `"Write every
user-facing sentence in German. Do not mix languages."`.

On a **retry** (after a failed grounding check, §6), the following is also
appended verbatim (`narrative.py:192-197`):

```
\n\nYour previous attempt was rejected for these reasons — fix them this time:
- {violation reason 1}
- {violation reason 2}
- ...
```

where each `{violation reason}` is one `GroundingViolation.reason` string
produced by the checker in §6 — i.e. the model is shown its own concrete
mistakes (exact rejected text, exact fabricated number, exact leaked UUID)
and asked to fix them.

## 5. The full, verbatim user-message template

Source: `narrative.py:347-353`.

```python
user_content = (
    f"Project context:\n{_summarize_project_context(request)}\n\n"
    f"Activities & outputs (what the project did):\n"
    f"{_summarize_output_facts(request.outputFacts)}\n\n"
    f"Outcome catalog (confirmed evidence of what changed):\n"
    f"{_summarize_catalog(request.catalog)}"
)
```

Rendering helpers (all in `narrative.py`), exact format strings:

**Project context** (`_summarize_project_context`, lines 25-35) — one line
per non-null field, in this order:

```
Project: {projectName}
Period: {projectPeriod}
Target group: {targetGroup}
Region: {region}
Starting situation before the project: {initialSituation}
```

**Per-entry line in the outcome catalog** (`_describe_entry`, lines 38-60),
one of three shapes:

```
- [{entryId}] PAIRED_DELTA "{pairLabel}" for outcome "{outcomeStatement}" ({outcomeTerm}-term): before={beforeValue}, after={afterValue}, matched pairs={nMatched} (of {nBaseline} baseline respondents).
```

```
- [{entryId}] DISTRIBUTION "{questionLabel}" for outcome "{outcomeStatement}" ({outcomeTerm}-term): n={n}, shares: {label}={count}, {label}={count}, ....
```

```
- [{entryId}] UNMEASURED outcome "{outcomeStatement}" ({outcomeTerm}-term): no confirmed evidence linked yet.
```

**Per output fact** (`_describe_output_fact`, lines 81-85):

```
- [{entryId}] OUTPUT_FACT "{label}" = {value formatted as % or plain number}. {narrativeReason}
```

If `catalog` is empty: `"No outcome-linked evidence available yet."`
(line 65). If `outputFacts` is empty: `"No activity/output facts
available."` (line 92).

**Where the request fields come from** (`ia_backend`'s `generateNarrative`,
`projectImpactStoryService.ts:552-571`):

| Request field                               | Source                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectName`, `region` (`areaOfOperation`) | `Project` document fields                                                                                                                                                                                             |
| `projectPeriod`                             | `buildNarrativePeriod(project.startMonth, project.endMonth)`                                                                                                                                                          |
| `targetGroup`                               | `project.overarchingTargetGroup`, falling back to the first non-blank entry in `project.targetGroups`                                                                                                                 |
| `initialSituation`                          | `Project.initialSituation` (the "Ausgangslage" field) — framing only, never treated as a grounded numeric source (see §4's prompt text and §6's checker: a number stated while paraphrasing it still fails grounding) |
| `outputFacts`                               | `toProjectImpactStoryNarrativeOutputFactRequests(headlineKpis)` — the project's headline KPIs from the chart-plan side, §7                                                                                            |
| `catalog`                                   | `toProjectImpactStoryNarrativeCatalogEntryRequests(impactCatalog)` — the confirmed-outcome impact catalog, §7                                                                                                         |

## 6. The checker (this is what produces the "detail could not be matched" banner)

**File**: `ia_python_service/app/project_impact_story/narrative_grounding.py`,
function `validate_narrative_output` (lines 141-237). **Deterministic, pure
Python — no LLM involved in the check itself.** Runs after every proposal
attempt, inside the shared retry loop (§6a).

Checks, in the order the code runs them:

1. **Unknown-entryId check** (lines 151-162): collects every
   `referencedEntryIds` value across all 3 paragraphs; if any id isn't in
   the catalog or output-fact id sets, that's a violation:
   `"References catalog entries that do not exist: [...]"`.
2. **Per-paragraph entry-count cap** (lines 164-180): more than
   `_MAX_CATALOG_ENTRIES_PER_PARAGRAPH = 5` (line 64) distinct catalog
   entries cited in one paragraph is a violation — this is what turns the
   prompt's "choose at most 5 entries" instruction from a hope into an
   enforced rule; the comment at lines 56-63 notes this was added after
   observing a real paragraph citing 15+ distribution entries as a data
   dump.
3. **Leaked entryId check** (lines 182-192): if a paragraph's raw `text`
   contains a UUID-shaped string (`_UUID_PATTERN`, lines 52-54:
   `\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`),
   that's a violation — the model wrote an entryId inline instead of
   confining it to `referencedEntryIds`.
4. **Number-grounding check** (lines 194-214) — the core check, and the one
   that specifically produces the observed banner:
   - For each paragraph, build a `candidate_pool`: every legitimate string
     rendering of every real value on every entry the paragraph
     references, via `_candidate_numbers_for_entry` (lines 80-120) and
     `_candidate_numbers_for_output_fact` (lines 129-138):
     - `paired_delta` → before value, after value, `nMatched`, `nBaseline`;
     - `single_distribution` → `n`, each share's count, each share's
       _label_ (since a Likert-scale label like "4" can legitimately be
       cited as a number without being a share count), and each share's
       count-as-percentage-of-`n` (as a "ratio");
     - `unmeasured` → no candidates (nothing to fabricate);
     - an `OUTPUT_FACT` → its `value`, formatted as a ratio if
       `formatAs === "percentage"`, else as a plain number.
   - Every candidate goes through `format_candidate_strings`
     (`ia_python_service/app/analytics/grounding.py:82-115`), which
     generates every "legitimate" textual form of a number a
     German-writing model reliably produces — both `41.7%`/`41,7%` (comma
     decimal separator) and `41.7 %`/`41,7 %` (space before `%`), verified
     against real model output that was otherwise being rejected as
     fabricated for using correct German number typography.
   - Extract every number-like token actually written in the paragraph's
     `text` (`_numbers_in_text`, lines 67-71, pattern
     `_NUMBER_TOKEN_PATTERN = re.compile(r"\d+(?:[.,]\d+)?\s*%?")`), first
     stripping any UUID matches so a UUID's own digit runs (e.g. `2389`
     from an entryId) aren't mistaken for a fabricated data value.
   - For every extracted token **not** found verbatim in `candidate_pool`,
     append a violation: `"Narrative contains a number ({token!r}) with no
matching value among its referenced entries: {text!r}"`.

   **This is exactly what the "a detail could not be automatically matched
   with your data" banner means at the code level**: a number in the LLM's
   prose that has no corresponding real value on any entry it cited (a
   miscalculation, a rounding the model wasn't supposed to do, a number
   copied from the wrong entry, or a number invented outright).

5. **Causal-language check** (lines 216-221):
   `contains_causal_language(paragraph.text)`
   (`app/analytics/grounding.py:65-71`) — checks the text against
   word-boundary-matched phrase lists for **every** supported language, not
   just the request's own language, as defense in depth against accidental
   code-switching. German list (`grounding.py:33-44`): `verursacht`,
   `verursachte`, `führte zu`, `führten zu`, `geführt zu`, `resultierte
aus`, `resultierte in`, `resultierten aus`, `aufgrund`, `auf grund`,
   `deswegen`. English list (lines 27-32): `caused`, `cause of`, `led to`,
   `leads to`, `resulted in`, `resulting in`, `because of`, `due to`.
   Word-boundary matching specifically because a naive substring match on
   German compounds is unsafe — the comment gives `"wegen"` ("because of")
   being a substring of `"bewegen"` ("to move") as the concrete false
   positive this would otherwise create (e.g. for a
   "Bewegungsprogramm"/movement program).
6. **Empty/non-empty consistency** (lines 223-235): source material
   non-empty but narrative empty → violation; both empty but narrative
   non-empty → violation.

Returns `GroundingResult(passed=len(violations) == 0, violations=violations)`.

### 6a. Retry loop and what happens on exhaustion

Shared generic loop: `run_with_grounding_retries`
(`ia_python_service/app/analytics/grounding_retry_loop.py:25-143`), used by
every LLM curation/generation stage in this service (chart-plan, dashboard
curation, this narrative call). For the narrative call specifically,
`_MAX_GROUNDING_RETRIES = 1` (`narrative.py:17`) — **up to 2 total LLM
calls** (one attempt, one retry), deliberately lower than the `2` used
elsewhere in this feature (see the "Known discrepancy fixed" note at the
bottom). The comment at `narrative.py:411-424` explains why: this call
sends the project's _entire_ evidence catalog as context on every attempt,
so retries here are more expensive than most other grounding-retry callers
in this service, and the budget is kept low rather than exhausted for its
own sake.

Flow, per `generate_project_impact_story_narrative`
(`narrative.py:376-474`):

1. `propose_with_capture(None)` → `_propose_narrative` (the OpenAI call in
   §3/§4/§5), capturing the draft in a `nonlocal last_draft` closure
   regardless of outcome.
2. `validate_narrative_output(draft, catalog, output_facts)` (§6).
3. **Pass** → `on_success` (lines 398-409): `groundingStatus="PASSED"`,
   `fellBackToDeterministicSummary=False`. Backend maps this to
   `narrativeStatus: "generated"` — **no banner**.
4. **Fail** → violation reasons are fed into the next `_propose_narrative`
   call as the "Your previous attempt was rejected..." suffix (§4), and the
   loop retries once more (`max_retries + 1 = 2` attempts total).
5. **Retries exhausted, still failing** → `on_exhausted`
   (`narrative.py:434-461`). Since at least one attempt always ran,
   `last_draft` is always set, so the _reachable_ branch (lines 438-445)
   returns:

   ```python
   ProjectImpactStoryNarrativeResponse(
       narrativeSummary=render_narrative_text(last_draft),
       groundingStatus="FAILED",
       groundingRetryCount=_MAX_GROUNDING_RETRIES,
       fellBackToDeterministicSummary=False,
       llmUsage=usage,
   )
   ```

   i.e. **the model's own last real draft, unverified** — not a template.
   `ia_backend`'s `generateNarrative` (`projectImpactStoryService.ts:580-585`)
   maps `groundingStatus !== "PASSED"` + `fellBackToDeterministicSummary ===
False` to:

   ```typescript
   const narrativeStatus: ProjectImpactStoryNarrativeStatus =
     response.groundingStatus === "PASSED"
       ? "generated"
       : response.fellBackToDeterministicSummary
         ? "deterministic_fallback"
         : "generated_unverified";
   ```

   → `narrativeStatus = "generated_unverified"` → the frontend renders
   **exactly the banner in the screenshot**
   (`impactStoryNarrativeBanner.tsx:81-84`, locale key
   `impactStory.narrativeUnverifiedNotice`,
   `ia_webapp/src/locales/de.ts:784-785`):

   > "Diese Zusammenfassung wurde von einer KI verfasst, aber ein Detail darin konnte nicht automatisch mit Ihren Daten abgeglichen werden."

   The alternate `on_exhausted` branch (lines 446-461, building
   `_build_deterministic_fallback_summary` with
   `fellBackToDeterministicSummary=True`) is explicitly commented as **"Not
   reachable today"** — `run_with_grounding_retries` always runs at least
   one attempt before it can call `on_exhausted`, and any exception from
   `propose_with_capture` bypasses `on_exhausted` entirely (the whole call
   raises instead, handled by `ia_backend`'s own catch block, §2 step 8).
   Kept only as a defensive fallback in case that shared contract ever
   changes.

## 7. Where the deterministic numbers actually come from

The LLM never computes a number — it only ever restates one that already
exists on a catalog entry `ia_backend` built. Two independently-computed
sources feed the narrative call:

- **`impactCatalog` (outcome catalog)** — built by
  `buildProjectImpactStoryImpactCatalog`
  (`projectImpactStoryImpactCatalog.ts`) exclusively from
  `OutcomeEvidenceLink` records a human has confirmed. For a
  `paired_delta` shape, `computePairedDeltaMeasurement`
  (lines 101-191) re-runs the measurement live, every generation, against
  _current_ privacy-safe evidence tables via
  `ActivityAnalysisV2ToolExecutor`: `count_rows` → `join_tables` (joined on
  the link's persisted `matchKey`) → `paired_change`. `nMatched` (the "n=48"
  style figure) is literally `pairedChangeResult.pairedCount`, the real
  matched-row count from that join. If `paired_change` returns an
  incomplete result, the function **throws** rather than defaulting to
  `0/0/0` (lines 165-171) — the impact-catalog builder then skips that
  broken link (logging a warning) instead of showing a fake zero. This was
  a real, documented bug fix — see `PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md`
  (this directory): the root cause was `matchKey` being persisted from a
  per-table heuristic column instead of a proven shared cross-wave join
  key, which silently produced `nMatched=0` that looked like real
  zero-movement data. The fix moved key selection into
  `OutcomeEvidenceRecommendationApprovalService` at confirmation time
  (scores every shared column across both tables by non-null counts /
  no-duplicates / actual matched count, rejects zero-match and ambiguous
  candidates) and made this function throw instead of default.
- **`headlineKpis` (output facts)** — `toProjectImpactStoryNarrativeOutputFactRequests`
  turns the project's chart-plan headline KPIs (participation counts,
  satisfaction rates, etc. — sourced from `ActivityAnalystV2` run
  `calculation`/`goal_assessment` output, gated only by V2's own grounding,
  not by human confirmation) into the `OUTPUT_FACT` list. These are the
  "296 Teilnahmen" / "84% Zufriedenheit" style figures — a structurally
  separate, more permissive source than the impact catalog (see
  `CURRENT_ANALYTICS_PIPELINE.md` Stage 1 for the full two-catalog
  architecture and why they're never merged).

`buildImpactCatalogFallbackNarrativeSummary`
(`projectImpactStoryService.ts:170-177`, used only when the whole Python
HTTP call throws — §2 step 8) is deliberately built field-for-field the
same way Python's own `_build_deterministic_fallback_summary`
(`narrative.py:152-185`) would, specifically so this backend-only emergency
path can never reintroduce the exact risk the impact-catalog restriction
exists to prevent (writing outcome-sounding prose over unconfirmed
reach/process data).

## 8. Staleness and the other banner

`isStale` (`GET /projects/:projectId/analytics` response field) drives the
**other** banner — "Seit der letzten Erzeugung gibt es neue
Datengrundlage..." (`impactStory.staleNotice`) — which is unrelated to the
grounding checker in §6. Computed on every read, never persisted
(`computeProjectImpactStoryStaleness`,
`ia_backend/src/modules/projectImpactStory/projectImpactStoryStaleness.ts:35-110`).
Stale if any of:

1. the project's current activity-id set differs from the story's
   `sourceSnapshot` activity ids;
2. the current latest-_completed_ `ActivityAnalysisRunV2` id, per activity,
   differs from what `sourceSnapshot` recorded (V2 runs are append-only, so
   a rerun is always a new document id);
3. there are zero current confirmed links but the overlay still has a
   non-empty `impactCatalog` (stale leftover);
4. confirmed links exist but there's no matching overlay at all;
5. the overlay's `impactCatalog` has more entries than the current
   confirmed-link count (a link was removed since the overlay was built);
6. the latest confirmed link's `updatedAt` is newer than the overlay's
   `updatedAt` (a link was added/changed since the overlay was built).

Conditions 3-6 were added by the same fix documented in
`PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md` — staleness previously only tracked
activity/run identity and ignored confirmed-link changes entirely, even
though `impactCatalog` is derived directly from those links.

## 9. Cost / rate-limit notes worth knowing before changing this

- Every "Analyse aktualisieren" click that doesn't hit an already-running
  job re-runs the **entire** pipeline from scratch: readiness re-check →
  chart-plan LLM call (up to 3 attempts, `chart_plan.py`'s own
  `_MAX_GROUNDING_RETRIES = 2`) → narrative LLM call (up to 2 attempts, §6a)
  → two new, append-only Mongo documents. Regeneration never updates a
  document in place.
- Rate-limited to 12 kickoff requests per authenticated user per 10 minutes
  (`processingKickoffRateLimitConfig`) and de-duplicated against an
  in-flight job for the same project, but **not otherwise debounced** — a
  legitimate distinct click still costs at least 2 real LLM calls
  end-to-end.
- `story.updatedAt` (rendered as "Erstellt am {{timestamp}}") is
  `Math.max(snapshot.updatedAt, overlay?.updatedAt ?? 0)`
  (`formatLatestTimestamp`, `projectImpactStoryService.ts:59-68`) — "most
  recently touched," not a field literally named `createdAt`, though it
  reads like a creation timestamp in the UI.

## Known discrepancy fixed

`CURRENT_ANALYTICS_PIPELINE.md`'s Stage 4 states "each runs its own
grounding-retry loop of up to 3 full LLM calls (`run_with_grounding_retries`,
`_MAX_GROUNDING_RETRIES = 2` in both `narrative.py` and `chart_plan.py`)."
Reading current source directly: `chart_plan.py:17` does say `2`, but
`narrative.py:17` says `_MAX_GROUNDING_RETRIES = 1` (max **2** attempts for
the narrative call, not 3), with an explicit comment
(`narrative.py:411-424`) explaining it was deliberately kept lower than
chart-plan's because this call's context (the full evidence catalog) is
larger and more expensive to resend on every retry. That canonical doc's
own header already notes it was written against an uncommitted working
tree, so this is most likely later drift rather than an error at the time
of writing — flagging here per this repo's standing rule to fold
corrections into the existing doc rather than let two docs silently
disagree. `CURRENT_ANALYTICS_PIPELINE.md` should be corrected to say `2`
for chart-plan and `1` for narrative specifically.
