# Project Impact Story — Chart & KPI Selection Deep Dive

Scope note: this file is a narrow, mechanism-level reference for exactly
one part of the Project Impact Story feature — how the dashboard's
headline KPI tiles and charts get selected and built (the LLM call, its
full prompt, the deterministic checker, and the backend execution/override
logic that runs on top of the LLM's picks). It exists alongside, not
instead of, `CURRENT_ANALYTICS_PIPELINE.md` (this directory), which is the
canonical architecture map for the whole feature (routing, staleness,
snapshot/overlay persistence, etc.) — read that first for context; this
file goes one level deeper on chart/KPI selection specifically, the same
way `PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md` (this directory) goes
one level deeper on the narrative text call. All three documents describe
one feature from three angles; if any two disagree on a shared fact,
prefer whichever file's stated scope actually owns that fact and fix the
other.

Everything below reflects source as read on 2026-08-29, including the
project's current uncommitted working-tree state (verified by reading
on-disk source directly, not git history).

## 1. What this covers, and what it doesn't

This feature produces two visually distinct groups of numbers on the
Analytics tab:

- **LLM-selected**: `headlineKpis` (4 tiles) and `chartPlan` (an ordered
  list of charts) — an LLM picks _which_ already-computed facts matter and
  _how_ to group/chart them; it never computes or invents a number itself.
  This document is about this path end to end.
- **Deterministic, never LLM-selected**: `goalProgressEntries` (the
  target-vs-achieved ranking), `backlogChartPlan` (one ready chart per
  catalog entry the LLM didn't pick), and two audit structures
  (`chartOpportunityAudit`/`chartSelectionAudit`). These are covered too
  (§9), because understanding what the LLM is and isn't responsible for
  requires seeing both halves — but they involve no LLM call.

Not covered here: the narrative text (`narrativeSummary`) — a completely
separate LLM call with its own grounding/catalog, documented in
`PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md`. The two calls share the
same triggering job and the same background worker, but read different
catalogs, run independently, and can fail independently of each other
(§8's ordering section shows exactly how they interleave).

## 2. What triggers this, and how it relates to the narrative call

Same trigger as the narrative call — there is exactly one user action that
produces both: clicking "Analyse aktualisieren" on the Analytics tab,
which is `POST /projects/:projectId/analytics` (alias
`/impact-story`). See `PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md` §1–2
and `CURRENT_ANALYTICS_PIPELINE.md`'s Stage 4 for the full job-creation/
worker-claim mechanics (readiness gate, existing-job dedup, the
`activityAnalysisWorker.ts` background process) — none of that differs for
chart-plan vs. narrative; both run inside the same claimed
`project_impact_story` job, in the same worker call to
`ProjectImpactStoryService.buildProjectImpactStory`.

Opening the tab (`GET /projects/:projectId/analytics`) never triggers
either LLM call — it only reads back the most recently generated result.

## 3. Building the catalog sent to the LLM

**Main file**: `ia_backend/src/modules/projectImpactStory/projectImpactStoryCatalog.ts`

**Entry point**: `buildProjectImpactStoryCatalog(activities, activityAnalysisRuns, uploads, language)`
(lines 100–169), called from `assertReadyForImpactStoryRun` (lines 390–395
of `projectImpactStoryService.ts`) — well before the LLM call itself runs
(see the full timeline in §8).

### 3a. Which run counts as "current" for an activity

`selectCurrentV2RunsByActivity` (`projectImpactStoryV2RunSelection.ts`,
full file, 83 lines) filters `activityAnalysisRuns` to `status ===
"completed"`, then picks the most recent by `createdAt` per `activityId`.
Critically, it then requires that run's `evidence[].uploadMetadataId`
set to **exactly equal** (same size, every id present) the activity's
_current_ set of uploads. If a completed run exists but the activity's
evidence has since changed (a new upload, or a deletion) — that run is
stale for this purpose, and the whole activity is excluded from the
catalog (pushed into an `activitiesExcludedIds` set), regardless of how
good the stale run's numbers look. An activity with no completed run at
all is excluded the same way. This exclusion feeds
`chartOpportunityAudit`'s `stale_or_missing_analysis_run`/
`no_evidence_uploaded` rows (§9).

### 3b. The four catalog entry kinds

The catalog is a discriminated union
(`ProjectImpactStoryCatalogEntry`), one of four `kind`s. Three are built
here; the fourth (`paired_story_delta`) is appended separately by the
caller (§3e) and is currently always empty.

**`calculation`** (lines 120–142) — one per grounded, displayable
calculation on the activity's current run:

- _Source_: `run.calculations` (`ActivityAnalysisV2CalculationRecord[]`,
  the deterministic tool-execution results persisted by `ActivityAnalystV2`
  — see `CURRENT_ANALYSIS_PIPELINE.md` Stage 11/13).
- _Grounding gate_: `collectGroundedCalculationIds(run)`
  (`projectImpactStoryGrounding.ts`) walks
  `run.assessment?.goalAssessments`, skips any goal whose
  `assessmentStatus` is `requires_clarification` or
  `requires_capability` (`UNGROUNDED_GOAL_ASSESSMENT_STATUSES`), and
  collects `supportingCalculationIds` from every other goal. A calculation
  not referenced by any grounded goal assessment never becomes a catalog
  entry — this is the _only_ place LLM-visible calculation facts are
  filtered by grounding; it filters calculation values, not the
  goal-assessment records themselves (those are all included regardless,
  see below).
- _Displayability gate_: `buildCalculationDisplayTile(calculation,
language)` (`projectImpactStoryCalculationDisplay.ts`) must return
  non-null. This function only recognizes tool names in the `KPI_TOOL_NAMES`
  allowlist (`count_rows`, `count_distinct`, `count_distinct_keys`,
  `profile_column`, `aggregate_numeric`, `intersection_count`,
  `union_count`, `calculate_ratio`, `calculate_difference`,
  `calculate_percent_change`, `calculate_sum`, `calculate_product`) plus
  two special cases (`group_count` → tile `kind: "category_rank"`,
  `time_bucket_count` → tile `kind: "line_series"`). This is deliberately
  an _allowlist, not a denylist_: several V2 tools
  (`create_cohort`, `first_event`/`last_event`, `group_aggregate`, the
  `*_set` variants, `date_difference`, `event_gap`,
  `days_since_last_event`, `period_change`, `paired_change`) build
  reusable intermediate results whose numeric `value` is a row/entry count
  of that intermediate table, not a meaningful project metric — showing it
  as a KPI would display a real-looking but nonsense number. A calculation
  whose tool isn't in this set, or whose bucket/trend data is empty,
  produces no tile and is dropped from the catalog outright.
- _`entryId`_: `` `${activityId}:calc:${calculationId}` `` via exported
  `buildCalculationEntryId` — reused verbatim by `projectChartOpportunityAudit.ts`
  so both surfaces agree on ids for the same fact.
- _Fields sent_: `toolName`, `unit`, `denominatorType` straight off the
  calculation record, plus the built `tile`.
- _Value_: for a `kind: "kpi"` tile, `tile.value` is
  `calculation.value` exactly as computed by the V2 deterministic
  tool-execution engine at analysis time. **The catalog builder never
  recomputes it, and neither does anything downstream** — chart-plan
  execution only ever aggregates (sum/average/count) _across_ these
  already-computed values (§6), never recomputes one.
- No cap on how many calculation entries can exist — every grounded,
  displayable calculation from every activity with a current run goes in.

**`goal_assessment`** (lines 144–158) — one per goal assessment, **every
status included**, unlike calculations:

- _Source_: `run.assessment?.goalAssessments ?? []`. Explicitly includes
  `requires_clarification`/`requires_capability` goals too — the gap
  itself is real, chartable data (e.g. "3 goals still need clarification"
  is a legitimate KPI); only the _calculation_ grounding gate above
  excludes ungrounded numbers, never the goal-assessment record.
- _`entryId`_: `` `${activityId}:goal:${goalId}` `` via
  `buildGoalAssessmentEntryId`.
- _Fields sent_: `goalType` (`"output"`), `goalText`, `assessmentStatus`,
  `achieved`, `measuredValue`, `targetValue`, `comparison` — all copied
  straight from `ActivityAnalysisV2GoalAssessmentRecord`, recomputed fresh
  by V2 on every run, never cached here.

**`context_distribution`** (lines 160–165) — deterministic descriptive
breakdowns with no goal/outcome link (e.g. a district or subgroup
breakdown over a categorical evidence column):

- _Source_: `run.contextCatalogEntries` — already persisted on the V2 run
  by an earlier pipeline stage. Every persisted entry is spread directly
  into the catalog with no additional filtering here.
- _Fields sent_: `labelDe`, `dimensionLabelDe`, `shares: {labelDe,
count}[]`, `n`, `eligibleChartTypes: ("hbar_target"|"donut_share")[]`,
  `sourceDe`. `eligibleChartTypes` matters later — it structurally caps
  which chart type this specific entry can ever render as, independent of
  what the LLM picks (§6).

### 3c. Wire-shape flattening for the LLM

`toProjectImpactStoryChartPlanRequestEntries` (lines 176–266) converts the
internal, tile-rich catalog above into the flat shape Python actually
receives (`ProjectImpactStoryChartPlanCatalogEntry`, `entryId, kind,
activityId, activityName, label, description, toolName, unit, value,
goalType, assessmentStatus, achieved`) — Python never sees tiles, buckets,
trend points, or `shares` detail:

- `context_distribution.description` is synthesized as
  `` `${dimensionLabelDe}; n=${n}. ${sourceDe}` `` — the model gets a
  one-line summary, not the raw share breakdown.
- `paired_story_delta.description` (when non-empty — currently never, see
  §3e) says "Exploratory before/after evidence, not confirmed outcome
  measurement; n=X matched" with `value: null` — Python only ever sees the
  matched-row count, never the two raw before/after numbers.
- `goal_assessment.label` = `goalText`; its `value`/`toolName`/`unit` are
  always `null`.

### 3d. Typical catalog size

No explicit cap exists anywhere in this pipeline on catalog size sent to
the LLM — it is exactly as large as "every grounded calculation, every
goal assessment regardless of status, every context distribution" across
every activity with a current run. A project with many activities and
rich evidence can send a correspondingly large catalog; the prompt (§4)
is written to actively want a full, multi-facet selection rather than a
short highlight reel, so a larger catalog is expected to translate into
more charts, not into the model discarding most of it.

### 3e. The fourth kind: `paired_story_delta` (currently always empty)

`buildProjectImpactStoryPairedStoryDeltaCatalog`
(`projectImpactStoryPairedStoryDeltaCatalog.ts`) unconditionally returns
`[]` as of 2026-08-27 (uncommitted) — the declared-pairing detection
mechanism it depended on was removed by the outcome-evidence merge (see
`OUTCOME_EVIDENCE_MERGE_PLAN.md`). It is called at
`projectImpactStoryService.ts` lines 475–493, and its (currently always
empty) result is concatenated onto the real catalog: `fullCatalog =
[...catalog, ...pairedStoryDeltaCatalog]` (line 494) — this is the
`fullCatalog` that both the LLM catalog and every deterministic
sibling mechanism (§9) actually consume. The type and every consumer
(catalog builder, chart backlog, chart-plan execution) are kept alive
only because historical, already-generated snapshots from before
2026-08-27 may still contain real `paired_story_delta` charts that need
to keep rendering — see `CURRENT_ANALYTICS_PIPELINE.md` Stage 3 for the
full story of this permanent disablement.

## 4. The chart-plan LLM call

**Route**: `POST /internal/project-impact-story/chart-plan` (Python).

**Call chain**: `ProjectImpactStoryService.planChartsAndKpis` (backend,
called from `buildProjectImpactStory` — see the exact ordering in §8) →
`pythonProcessingClient.planProjectImpactStoryChart` → the route above →
`plan_project_impact_story_chart` (`chart_plan.py`).

**Request** (`ProjectImpactStoryChartPlanRequest`): `{projectId,
projectName, language: "de"|"en", catalog: [...] (§3c's flattened
entries), allowedChartTypes: string[], headlineKpiCount: number}`.

**`allowedChartTypes` and `headlineKpiCount` are hardcoded TypeScript
constants**, not config and not computed:
`PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES = ["bar", "pie", "line",
"comparison", "distribution"]` and
`PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT = 4`
(both `projectImpactStoryChartPlanExecution.ts`). `projectImpactStoryService.ts`
imports both and passes them straight through unchanged.

**Auth/timeout**: shared-secret header
(`x-internal-service-token`, `authHeaders()`), timeout
`projectImpactStoryLlmTimeoutMs = 300_000` ms (`pythonProcessingClient.ts`)
— deliberately raised above the generic 120s LLM timeout because this call
runs inside the background worker job (not the live HTTP request) and
internally runs its own grounding-retry loop of up to 3 full LLM calls
(§7), observed in practice to sometimes exceed 120s.

**Model/params** (`chart_plan.py`'s `_propose_chart_plan`, via
`parse_structured_chat_completion`): `model = get_settings().openai_model`
(`"gpt-5-mini"`), `temperature=0`, `seed=0`, no `reasoning_effort` override
(unlike the V2 planner, which does set one) — structured-output parsing
against `ProjectImpactStoryChartPlanDraft` as the `response_format`.

**Zero-catalog short-circuit**: if `request.catalog` is empty,
`plan_project_impact_story_chart` returns immediately
(`{headlineKpis: [], chartPlan: [], groundingStatus: "PASSED",
fellBackToDeterministicSelection: false, llmUsage: None}`) with **no LLM
call at all** — this is also mirrored on the backend side: if the built
catalog is empty, `projectImpactStoryService.ts` (lines ~639–650) never
even calls Python.

## 5. The full, verbatim system prompt

Built fresh on every attempt (retries append a violation-feedback
paragraph — see §7). This is the complete text as of `chart_plan.py`
lines 67–223, with `{request.headlineKpiCount}` substituted (currently
always `4`):

> You design the story for an NGO project's impact dashboard from
> already-computed facts. You never compute, estimate, or invent a number
> yourself — every entry in the catalog already carries its final value
> (if any). Your job is only to select which catalog entries matter most
> and how to group them, copying entryId values exactly from the input
> catalog — never invent one, never reference one not shown to you.
>
> Return exactly 4 headlineKpis: the highest-value project-wide numbers a
> funder or reviewer would want first. Each KPI picks one or more
> entryIds and an aggregation: 'single' (exactly one entry, its own
> value), 'sum' (add the selected entries' values — only ever select
> entries that measure the literally same thing, e.g. the same toolName
> and unit, across different activities), 'average' (mean of the selected
> entries' values, same comparability requirement as sum), or 'count'
> (the number of selected entries — use this for goal-assessment entries,
> e.g. 'activities with an achieved output' or 'goals still needing
> clarification').
>
> Then return an ordered chartPlan that reads as one connected story of
> the whole project — reach, process, and results — not a highlight reel
> of only the two or three single strongest facts. A funder or board
> reader wants the fuller picture: how people were reached, what the
> project actually ran, and what changed. Aim for at least 8 charts,
> ideally 10 to 12, whenever the catalog has this much ready material —
> do not stop at 3 to 5 just because a handful of facts feel like the
> clear highlights. An honest, modest chart that adds one real fact the
> reader didn't have yet is worth including even if it isn't the single
> most dramatic number in the catalog; leaving real, ready evidence out
> of the story is a bigger loss than one chart that is merely good rather
> than exceptional. Only fall short of that range if the catalog
> genuinely does not have enough distinct, real facts to support it —
> never by choice when it does.
>
> To reach that range, actively look for one chart per distinct facet
> below rather than converging early on your favorites — treat this as a
> coverage checklist, not a ranked top-3:
>
> - Reach and recruitment: how many people or applications entered the
>   funnel, and at what stage (registered, selected, trained, attended).
> - Completion and participation: attendance/completion rates or counts
>   for each distinct activity that ran, not just the largest one.
> - Every distinct category or subgroup breakdown the catalog supports
>   that actually informs reach, process, or outcome. The test is
>   relevance, not how many categories it has or how evenly distributed
>   the counts are: a breakdown by district, school, activity stage, or
>   assessment/review status says something about where the project
>   reached people or how it ran, and belongs in the story. A breakdown
>   of participants' own pre-existing personal or professional traits —
>   something true about them before they ever encountered the project,
>   and not something the project's own process measures, screens, or
>   acts on (e.g. participants' prior occupation before joining, unrelated
>   biographical trivia) — does not belong, even when its categories are
>   well-populated and clearly distributed. Before including any
>   breakdown, ask: if a reader saw only this chart and nothing else,
>   would they learn something about whether the project reached the
>   people it meant to, how its process performed, or where it stands
>   against a goal? If the honest answer is 'no, they'd just learn a fact
>   about who these people happen to be,' leave it out — it is an
>   interesting fact about the participants, not a fact about the
>   project, no matter how clean the data looks. If the catalog has two
>   or three different breakdowns that each pass this test, include each
>   of them as its own chart rather than picking only one.
> - Bottlenecks or drop-off between stages (e.g. registered vs. attended
>   vs. completed), if the catalog supports it.
> - A behavior/next-step distribution (e.g. what people did after an
>   activity), if the catalog supports it.
> - The same measure compared side by side across activities, where the
>   comparability rules above allow it.
> - Change over time, for every calculation that has period-based data,
>   not just one.
> - A plain 'goals achieved vs not achieved' status chart, once — useful
>   as one beat among many here, even though it mostly restates what the
>   headline KPIs already show; just do not let it be one of only three
>   or four charts total.
>
> Skip a facet only when the catalog genuinely has nothing real to say
> there, never to keep the total count low.
>
> Never propose two charts that visualize the same underlying set of
> catalog entries, or that differ only cosmetically (e.g. the same
> goal-assessment entries first grouped by status and then shown again
> individually) — each duplicate wastes a chart slot another facet could
> have used instead. Reaching a high count by duplicating a beat is not
> the goal; reaching it by covering more distinct facets is.
>
> Choose the chart type by what it needs to show, not by habit — do not
> let 'distribution' become the reflexive answer for every categorical
> breakdown just because it always technically works; check the 'pie'
> case first for anything that is one whole group broken into a few
> parts:
>
> - 'pie': check this first for any breakdown that is a genuine
>   part-to-whole of one coherent group — an assessment/review/status
>   outcome across everyone assessed (e.g. how a safeguarding check, a
>   background-check, or an approval step resolved for the full group),
>   or any other case where the segments are literally 'all of X, split
>   into these buckets.' Use it whenever that group has at most 4-5
>   segments with clearly different sizes and short labels — do not
>   default to 'distribution' just because the category count is 3 or
>   more. Never use 'pie' for close values (e.g. three segments all
>   within a few points of each other) or for a ranking/comparison that
>   is not really one whole (e.g. counts per activity, per district) —
>   those stay 'distribution'.
> - 'distribution': horizontal ranked bars. Use this for rankings,
>   funnels, and breakdowns by category or activity that are not a single
>   coherent whole — e.g. applications per district, attendance per
>   activity — or whenever a category label is longer than a short word
>   or two, since horizontal bars keep long labels readable. Also the
>   fallback for a part-to-whole breakdown with more than 5 segments or
>   too-close values for 'pie' to read cleanly.
> - 'bar' or 'comparison': vertical bars, for comparing 2 (at most 3)
>   genuinely distinct, independent measures side by side — e.g.
>   applications received vs. mentors selected, or the goals-achieved-vs-
>   not-achieved verdict count — where every label is a single word or
>   very short phrase. Do not reach for this just because a breakdown
>   happens to have only 3 categories: if the 3 categories are instead
>   one single population sorted into its own status buckets (not
>   separate measures being compared to each other), that is the 'pie'
>   case above, not this one.
> - 'line': change over time from period-based data only.
>
> Which entries a single chart may combine depends on their kind, not on
> what would make a good story — a chart whose entryIds mix kinds it
> cannot actually combine will be silently dropped instead of rendered,
> wasting the slot: a CONTEXT_DISTRIBUTION or PAIRED_STORY_DELTA entry
> only ever renders alone — one such entry per chart, never two combined
> into one, even if they seem related (e.g. an availability breakdown and
> a safeguarding-check breakdown from the same activity are two separate
> charts, not one). GOAL_ASSESSMENT entries may be grouped together (e.g.
> by status). CALCULATION entries may only be combined with each other
> under the sum/average comparability rule above. Never mix different
> kinds in the same chart's entryIds.
>
> Descriptive context-distribution entries are valid supporting evidence
> for scene-setting or subgroup breakdowns, but they are not proof of
> outcome change by themselves. Use them to support the story, not to
> imply causal impact.
>
> PAIRED_STORY_DELTA entries show a real before/after measurement on the
> same group, but — unlike a CALCULATION or GOAL_ASSESSMENT — no human has
> confirmed it as outcome evidence; treat it exactly like a
> CONTEXT_DISTRIBUTION for selection purposes: legitimate supporting
> evidence, never something to feature as if it were a measured result.
> Its title/narrativeReason must describe it neutrally (e.g. 'observed
> change' or 'before and after') and must never claim it proves impact,
> effectiveness, or that a goal was achieved. These are legitimate beats
> in their own right, not just a single fallback — if the catalog offers
> several distinct PAIRED_STORY_DELTA signals (e.g. one per activity or
> per measured skill), include one chart for each of them rather than
> only the strongest, as long as every one stays neutrally worded.
>
> Prefer charts over KPI tiles whenever a distribution, comparison, or
> trend would tell the story better than a single number. Every chart
> references only the catalog entries it visualizes.
>
> If a KPI or chart cannot be grounded in real catalog entries, leave it
> out rather than forcing it.

Appended to the system message (not the text above; a separate string
concatenated on, `chart_plan.py` line 237): `Write every user-facing
label/title/reason in {language_name}.` — the same language-instruction
pattern used by the narrative call and the V2 planner.

On a retry (violation feedback from a failed grounding check, §7), one
more paragraph is appended to the end of the system prompt text above,
before the language instruction:

> Your previous attempt was rejected for these reasons — fix them this
> time:
>
> - {reason 1}
> - {reason 2}
>   ...

## 6. The full, verbatim user-message template

`chart_plan.py` lines 225–229:

```
Project: {request.projectName}

Allowed chart types: {', '.join(request.allowedChartTypes)}

Catalog entries:
{one line per catalog entry, formatted per kind below}
```

Each catalog entry is rendered as exactly one line via `_describe_entry`
(lines 25–47), by kind:

- **calculation**: `- [{entryId}] CALCULATION "{label}" = {value}` (the
  `= {value}` segment omitted entirely if `value is None`)
  ` (tool: {toolName}, unit: {unit}, activity: {activityName}). {description}`
- **context_distribution**: `- [{entryId}] CONTEXT_DISTRIBUTION "{label}" (activity: {activityName}). {description}`
- **paired_story_delta**: `- [{entryId}] PAIRED_STORY_DELTA "{label}" (activity: {activityName}). {description}`
- **goal_assessment**: `- [{entryId}] GOAL_ASSESSMENT ({goalType}) "{label}": status={assessmentStatus}, achieved={achieved} (activity: {activityName})`

If the catalog is non-empty but happens to summarize to nothing (never
actually reachable given the zero-catalog short-circuit in §4, but
defensively handled): `_summarize_catalog` returns the literal string
`"No catalog entries available."` when passed an empty list.

## 7. The checker, retry loop, and fallback

**File**: `app/project_impact_story/chart_plan_grounding.py` (`validate_chart_plan_output`).

Unlike the narrative call's checker (which validates free-text number
grounding — see the narrative doc's §6), this schema carries **no numeric
`value` field anywhere** the model could invent — it only ever _selects_
`entryId`s. So this checker is almost entirely referential-integrity and
well-formedness, not number-matching:

- exactly `expected_headline_kpi_count` (4) headline KPIs, or a violation
- no duplicate `kpiId` / `chartId` values
- every KPI/chart references at least one `entryId`
- every referenced `entryId` must exist in the real catalog — any unknown
  id is a violation (`sorted(unknown_ids)` reported)
- a `single`-aggregation KPI must reference exactly one entry
- every chart's `chartType` must be in `allowed_chart_types`
- **the one text-content check this stage owns**: for any chart where at
  least one resolved entry has `kind == "paired_story_delta"`, the chart's
  `title` and `narrativeReason` are run through `contains_causal_language`
  (shared with the narrative checker — a fixed-phrase, case-insensitive,
  whole-word regex check across both English patterns — `caused`, `cause
of`, `led to`, `leads to`, `resulted in`, `resulting in`, `because of`,
  `due to` — and German patterns — `verursacht`, `verursachte`, `führte
zu`, `führten zu`, etc. — checked regardless of the request's own
  language, as cheap defense against accidental code-switching). A hit is
  a violation: an unconfirmed before/after pair must never be described
  with causal/effectiveness language.

Deliberately **not** checked here (the file's own header comment is
explicit about this split): whether entries combined into one KPI/chart
are _structurally_ comparable (same `toolName`/`unit`/`denominatorType`)
— that domain-specific gate is `ia_backend`'s job
(`projectImpactStoryChartPlanExecution.ts`, §8 below), mirroring the same
"Python plans, backend executes" split `CURRENT_ANALYSIS_PIPELINE.md`
documents for the V2 planner.

**Retry loop**: the same shared `run_with_grounding_retries` helper the
V2 planner and narrative call use (`app/analytics/grounding_retry_loop.py`
— full mechanics: propose → validate → on failure, feed violation reasons
back into the next `propose` call as plain strings). Chart-plan's own
constant: `_MAX_GROUNDING_RETRIES = 2`, i.e. **up to 3 total LLM calls**
(1 initial + 2 retries). Unlike the V2 planner, chart-plan does **not**
pass a `max_wall_clock_seconds` budget into the shared loop — there is no
early-stop-before-an-attempt-you-can't-finish behavior here; every attempt
always runs to completion, bounded only by the outer 300s HTTP timeout
(§4).

**On exhaustion** (`on_exhausted` in `chart_plan.py`, lines 310–321):
`_fallback_chart_plan(catalog, headline_kpi_count)` — a deterministic,
no-LLM, in-process fallback distinct from `ia_backend`'s own emergency
fallback (§9 covers the difference). It filters `catalog` to `kind ==
"calculation" and value is not None`, takes the first `headline_kpi_count`
such entries in catalog order (**not** a real relevance ranking — the
function's own docstring calls this out explicitly, "deliberately
simple... same honesty as curation.py's `_fallback_selection`"), and
builds one `single`-aggregation KPI per entry with a fixed
`narrativeReason: "Deterministic fallback selection."` and `kpiId:
f"fallback-kpi-{index}"`. **It never produces any `chartPlan` entries** —
`chartPlan: []` always. The response is returned with
`groundingStatus: "FAILED"`, `fellBackToDeterministicSelection: True`.

Note this Python-side fallback still requires the _call itself_ to have
succeeded 3 times and failed grounding each time — it is unrelated to
`ia_backend`'s fallback (§9), which triggers only when the whole HTTP call
throws.

## 8. Backend execution: nothing from Python is trusted as a resolved fact

**Main file**: `ia_backend/src/modules/projectImpactStory/projectImpactStoryChartPlanExecution.ts` (`executeProjectImpactStoryChartPlan` and helpers).

This is the step that turns Python's `entryIds`/`aggregation`/`chartType`
_selections_ into real, numbered `ProjectImpactStoryHeadlineKpi`/
`ProjectImpactStoryChartSpec` objects. Every one of the following is
**re-derived from `ia_backend`'s own copy of the catalog**, never trusted
from Python's response body.

### 8a. entryId re-resolution

`resolveEntries`: every `entryIds` array Python returned is looked up
against a `Map` built from the backend's own catalog (the same object
that was sent to Python, not a re-fetch). If **any** id fails to resolve,
the whole candidate (KPI or chart) is discarded — the code comment is
explicit that this exists as defense-in-depth even though Python's own
grounding check (§7) already rejects unknown ids: "this backend copy of
the catalog is the actual source of truth, so it re-checks rather than
trusting that check ran."

### 8b. Structural comparability gate (`asComparableCalculationKpis`)

Given a resolved set of entries for a `sum`/`average`/multi-entry
aggregation:

1. Every entry must be `kind === "calculation"` with `tile.kind ===
"kpi"` and a non-null `tile.value` — a mix with `goal_assessment`, or a
   calculation whose tile is `category_rank`/`line_series`, fails
   outright.
2. The **first** entry is compared against every other entry on exactly
   three fields: `toolName`, `unit`, `denominatorType`. Any mismatch on
   any of the three rejects the whole set.
3. This applies identically whether the entries span multiple activities
   or sit on the same one — cross-activity comparison (e.g. summing a
   ratio from Activity A with a differently-based ratio from Activity B)
   is the primary case this exists to prevent, but a same-activity mix of
   incompatible tools is blocked the same way.

### 8c. What "silently dropped" means in practice

When a KPI candidate fails resolution or the comparability gate,
`buildKpi` returns `null`; the caller increments an in-memory
`droppedKpiCount` and simply omits the candidate — **there is no
per-candidate reason code kept anywhere**, only this aggregate count.
The same applies to chart candidates via `buildChart` and
`droppedChartCount`. Both counts are logged (not persisted on the
record) by `planChartsAndKpis`'s completion log line, alongside
`selectedEntryCount`. Nothing in `ProjectImpactStoryDiagnostics` records
_why_ a specific candidate was dropped — the closest available signal for
"this looked ready but didn't show up" is `chartSelectionAudit` (§9),
which answers a related but distinct question (an entry that was
`ready_now` per the opportunity audit but never ended up in any accepted
KPI/chart), not "this specific LLM-proposed chart was rejected and here's
why."

### 8d. Aggregation math — always recomputed here, never trusted from Python

Python's response carries no numbers, only `entryIds` + `aggregation`.
`buildKpi` computes the real value every time:

- `"count"` → `entries.length`.
- `"single"` with exactly one `goal_assessment` entry → delegates to
  `buildGoalAssessmentKpi` (below).
- `"single"` with a calculation entry → requires exactly one entry to
  survive the comparability gate; value = that entry's raw `tile.value`,
  `formatAs` taken from the tile itself.
- `"sum"`/`"average"` → `total = Σ value`; `sum` returns `total`,
  `average` returns `total / count`; `formatAs = "percentage"` if the
  (now-verified-identical) `unit === "ratio"`, else `"number"`.

**Goal-assessment KPI** (`buildGoalAssessmentKpi`/`computeGoalStatus`):
requires both `measuredValue` and `targetValue` non-null (and
`targetValue !== 0`), else dropped. Status is computed fresh every time,
never cached: `achieved === true` → `"good"`; else compute
`progressRatio` (`comparison === "at_most" ? targetValue/measuredValue :
measuredValue/targetValue`) and classify `>= 0.8` (`PROJECT_IMPACT_STORY_GOAL_WARN_THRESHOLD`)
as `"warn"`, otherwise `"risk"`. A `warn`/`risk` status attaches a
localized `statusCallout` (e.g. "Needs attention: N% of target reached so
far.").

### 8e. Pie-vs-distribution override — a hard override, not a suggestion

`resolveContextDistributionChartType`/`isPartToWholeShape`, applied only
when a chart resolves to exactly one `context_distribution` entry:

- Constants: pie requires 2–5 non-zero segments
  (`CONTEXT_DISTRIBUTION_PIE_MIN_SEGMENTS`/`_MAX_SEGMENTS`) **and** at
  least 30% spread between the largest and smallest non-zero segment
  (`(max-min)/max >= CONTEXT_DISTRIBUTION_PIE_MIN_SPREAD (0.3)`) — i.e.
  near-equal wedges don't qualify even inside the 2–5 range.
- If the shape qualifies as part-to-whole by those rules, the chart type
  is **forced to `"pie"` regardless of what the LLM picked**.
- Otherwise, if the LLM's candidate was `"pie"`, it's **downgraded to
  `"distribution"`**. Any other LLM-picked type passes through unchanged.
- Independently, `isAllowedContextDistributionChartType` gates which
  types are even structurally legal for a given entry based on its own
  `eligibleChartTypes` (from §3b: `"distribution"`/`"bar"` require
  `"hbar_target"`; `"pie"` requires `"donut_share"`) — a candidate whose
  type isn't legal for that entry's declared eligibility is dropped
  before the override above even runs.

### 8f. Goal-progress dedup

When every resolved entry in a chart candidate is `kind ===
"goal_assessment"` **and** the caller-supplied `hasGoalProgressChart` flag
is `true` (see §9 — this is `goalProgressEntries.length > 0`, computed
_before_ chart-plan runs at all), the candidate is dropped
unconditionally — the deterministic goal-progress ranking (§9) already
covers this ground, so the LLM's own "goals by status" chart would be a
near-duplicate. If `hasGoalProgressChart` is `false` (no goal has a
resolvable measured/target ratio at all), the same candidate instead
builds a real `dataKind: "status"` bar chart grouping goals by
`assessmentStatus` — this is the _only_ circumstance under which that
particular LLM-selected chart survives.

### 8g. Chart-level dedup by entryId set

`buildChartEntryIdSetSignature` = the sorted, deduplicated, pipe-joined
set of a chart's `entryIds` (order-independent). A later candidate whose
signature exactly matches an _already-accepted_ chart's signature is
dropped, regardless of its own title/subtitle/chart type. Signatures are
recorded only after successful acceptance — a candidate rejected for an
unrelated reason (e.g. failed comparability gate) never blocks a later,
different candidate that happens to reuse part of its entry set.

### 8h. Paired-story-delta chart-type restriction

A chart resolving to a single `paired_story_delta` entry may only use
chart type `"comparison"` or `"bar"` — pie/line/distribution are rejected
outright (a before/after pair is deliberately never shown as a
share-of-whole, ranking, or time series).

### 8i. `selectedEntryIds` — the real output that feeds everything downstream

The union of every `entryIds` string from every candidate that was
**actually accepted** into the final `headlineKpis`/`chartPlan` — not
every id Python requested. This is what `projectImpactStoryChartBacklog.ts`
and `projectChartSelectionAudit.ts` both consume (§9); it is the single
source of truth for "was this fact used anywhere on the dashboard this
run."

## 9. Deterministic siblings — never subject to LLM selection

These all read from the same `fullCatalog` (§3e) but involve no LLM call
of their own, and three of the four are computed **before** the chart-plan
LLM call even runs (see the exact order in §10):

- **`goalProgressEntries`** (`projectImpactStoryGoalProgress.ts`,
  `buildProjectImpactStoryGoalProgressEntries(fullCatalog)`) — built from
  the catalog's `goal_assessment` entries only, entirely independent of
  chart-plan selection. Skips a goal if `measuredValue`/`targetValue` is
  null, `targetValue === 0`, `achieved === null`, or a zero-measured
  ceiling goal (`comparison === "at_most" && measuredValue === 0`, to
  avoid a divide-by-zero). Computes `status` via the same
  `computeGoalStatus` chart-plan execution uses, and
  `progressPercent = round(ratio * 100)` (can exceed 100). Always
  rendered on the frontend whenever non-empty — no selection step at all.
  Its only interaction with the LLM path is one-directional:
  `goalProgressEntries.length > 0` becomes the `hasGoalProgressChart`
  flag passed into chart-plan execution (§8f).
- **`chartOpportunityAudit`** (`projectChartOpportunityAudit.ts`,
  `buildProjectChartOpportunityAudit(...)`) — also computed before
  chart-plan runs. Reuses the same entryId builders as the real catalog so
  ids line up 1:1. Classifies every goal assessment as `ready_now`
  (`achieved`/`not_achieved`/`evidence_compiled`/`mixed_evidence`),
  `blocked_by_extraction` (`requires_capability` — "a deterministic tool
  the plan needed doesn't exist yet"), or `blocked_by_missing_data`
  (`qualitative_evidence_only`/`requires_clarification`/default —
  "evidence exists but isn't measurable yet, or needs a clarification
  answer"). Every calculation entry is `ready_now`/`grounded_calculation`
  by construction (only grounded, displayable calculations reach the
  catalog at all). Every context-distribution entry is
  `ready_now`/`materialized_context_distribution`; a per-activity
  synthetic row is added as `blocked_by_extraction`/`missing_epistemic_role`
  whenever `run.diagnostics.contextExtraction.contextCandidatesExcludedByMissingEpistemicRole
  > 0`. Activities excluded entirely from the catalog (§3a) get one row
each: `blocked_by_missing_data`/`stale_or_missing_analysis_run`(has
uploads, run just stale/missing) or`.../no_evidence_uploaded` (no
  > uploads at all) — unless the activity is still contributing to the
  > narrative via a confirmed outcome-evidence link, in which case it's
  > skipped here.
- **`chartSelectionAudit`** (`projectChartSelectionAudit.ts`,
  `buildProjectChartSelectionAudit(opportunityAudit, selectedEntryIds)`)
  — computed _after_ chart-plan execution, since it needs
  `selectedEntryIds` (§8i). Filters the opportunity audit to
  `ready_now`, then to entries **not** in `selectedEntryIds` — literally
  "available and materialized, but the chart planner didn't put it
  anywhere." A "high-signal" subset (only `context_distribution`/
  `calculation` kinds — goal assessments and paired-story-deltas excluded
  from this narrower subset) generates human-readable
  `selectionWarnings` strings: `` `"${title}" (${activityName}) was ready
but not selected into any chart or KPI.` ``. Both audits are computed
  from one generation run's own data and never recomputed later against
  since-changed data.
- **`backlogChartPlan`** (`projectImpactStoryChartBacklog.ts`,
  `buildProjectImpactStoryChartBacklog(catalog, selectedEntryIds,
language)`) — computed _after_ chart-plan execution (needs
  `selectedEntryIds`). Iterates every catalog entry not already selected
  and builds one ready-to-render chart, reusing the exact same
  `buildChartData`/`resolveContextDistributionChartType` helpers chart-plan
  execution itself uses (not a separate rendering path): a
  `context_distribution` entry gets the same pie-override logic (seeded
  with `"distribution"` as the default); a `paired_story_delta` entry
  always becomes a `"comparison"` chart with `isExploratory: true`; a
  `calculation` entry only produces a backlog chart if its tile is
  `category_rank` (→ `"distribution"`) or `line_series` (→ `"line"`) — a
  plain scalar KPI tile produces nothing, since a single-number backlog
  "chart" isn't meaningful. `goal_assessment` entries deliberately never
  produce backlog charts — they already live in the goal-progress ranking
  or read better as a KPI. Chart ids are prefixed `` `backlog:${entryId}` ``
  so they can never collide with an LLM-chosen or deterministic chart id.
  The Analytics tab's backlog panel lets a viewer add any of these
  instantly (see `CURRENT_ANALYTICS_PIPELINE.md` Stage 6 for the UI side).

## 10. Exact ordering inside one generation run

All of the following happens inside one call to
`ProjectImpactStoryService.buildProjectImpactStory`, itself invoked by
`activityAnalysisWorker.ts` after claiming a `project_impact_story`
processing job:

1. `assertReadyForImpactStoryRun` runs first. Inside it, in order:
   a. Activity/upload/run context loaded; activity cards assembled.
   b. **`buildProjectImpactStoryCatalog`** — the chart-plan catalog (§3)
   is built.
   c. The narrative-only `impactCatalog` (confirmed `OutcomeEvidenceLink`
   records) is built separately — structurally unrelated to the
   chart-plan catalog.
   d. `pairedStoryDeltaCatalog` (§3e, always `[]`) is built and
   concatenated onto the chart-plan catalog → `fullCatalog`.
   e. **`goalProgressEntries`** is built from `fullCatalog` — before any
   LLM call.
   f. **`chartOpportunityAudit`** is built — also before any LLM call,
   from the same run data.
2. Back in `buildProjectImpactStory`: catalog counts are logged.
3. **`planChartsAndKpis` runs** — this is the call that reaches Python
   (§4–§7) and then immediately runs `executeProjectImpactStoryChartPlan`
   (§8) on the response, passing in `hasGoalProgressChart =
goalProgressEntries.length > 0` (computed back in step 1e). **This is
   the one moment in the whole pipeline where an LLM actually chooses
   which facts become which charts.**
4. The old context-catalog fallback (`fallbackContextCharts`, a separate,
   older mechanism kept only as a last resort) is used only if
   `chartPlanResult.chartPlan.length === 0` after step 3 — otherwise
   discarded.
5. **`backlogChartPlan`** is built (§9), using `chartPlanResult.selectedEntryIds`
   from step 3.
6. **`chartSelectionAudit`** is built (§9), diffing step 1f's opportunity
   audit against step 3's `selectedEntryIds`.
7. **The snapshot is persisted** (`project_analytics_snapshots`) —
   `headlineKpis`, `chartPlan`, `backlogChartPlan`, `contextCharts`,
   `goalProgressEntries`, and `diagnostics.{chartOpportunityAudit,
chartSelectionAudit}` are all written here, together, in one document.
   This happens **before** any narrative work.
8. If `impactCatalog.length === 0`, the function returns immediately
   after step 7 — no narrative call, `overlay: null`. **Everything above
   (chart-plan included) already happened and is already persisted**,
   independent of whether the project has any confirmed outcome evidence
   at all.
9. Otherwise, narrative generation runs (a completely separate LLM call —
   see `PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md`) and a second
   document, the overlay (`project_impact_stories`), is persisted
   referencing the snapshot from step 7.

**Failure isolation**: a chart-plan failure (Python HTTP call throws —
§11) never blocks the snapshot from persisting or the narrative from
being attempted; a narrative failure never rolls back the already-
persisted snapshot. The two are independent by explicit design (comment
in `projectImpactStoryService.ts`: "chart-plan failure and narrative
failure are independent and shouldn't block each other"). Neither failure
prevents the background job from completing successfully — the job always
returns a `ProjectImpactStoryRecord`.

## 11. `ia_backend`'s own emergency fallback — distinct from Python's

**File**: `projectImpactStoryChartPlanFallback.ts`,
`buildDeterministicFallbackChartPlan(catalog, language)`.

This is a **second, separate** fallback from the one in §7 — invoked only
when the whole HTTP call to Python throws (network error, non-2xx
response, timeout, or a malformed-response Zod validation failure inside
`pythonProcessingClient.ts`), caught in `planChartsAndKpis`'s `catch`
block. It is **not** invoked when the call succeeds but Python's own
internal fallback already fired (`groundingStatus: "FAILED"` — that
response still flows through `executeProjectImpactStoryChartPlan`
normally, since it already contains real, if simply-chosen, candidates).
It is also not invoked on the zero-catalog short-circuit (§4) — that path
never calls Python and returns empty results directly.

- **Only produces `headlineKpis` — never any `chartPlan` entries.**
- Built entirely from `catalog.filter(kind === "goal_assessment")`; if
  there are zero goal-assessment entries, returns `{headlineKpis: []}`
  (does **not** fall back further to calculation or context-distribution
  entries).
- Produces exactly 4 fixed KPIs when goal assessments exist, each with a
  hardcoded, localized label (fixed 2026-08-27/28 to actually localize —
  see `CURRENT_ANALYTICS_PIPELINE.md` Stage 3):
  1. `fallback-goals-achieved` — count where `assessmentStatus === "achieved"`.
  2. `fallback-activities-with-achieved-output` — count of distinct
     activities with at least one achieved `"output"`-type goal.
  3. `fallback-goals-not-achieved` — count where `assessmentStatus === "not_achieved"`.
  4. `fallback-evidence-coverage` — `(total - gapGoals) / total` as a
     percentage, where `gapGoals` = goals with `requires_clarification`/
     `requires_capability` status.
- This function never throws; `planChartsAndKpis` as a whole is
  documented to never throw.

## 12. Data stores — what's persisted vs. ephemeral

**`project_analytics_snapshots`** stores the **executed, backend-computed**
output only — `headlineKpis`/`chartPlan` are the real
`ProjectImpactStoryHeadlineKpi[]`/`ProjectImpactStoryChartSpec[]` produced
by §8, not Python's raw candidate list. **Python's raw chart-plan response
(the pre-execution `entryIds`/`aggregation`/`chartType` candidates,
`groundingStatus`, `fellBackToDeterministicSelection`) is never persisted
anywhere** — it exists only transiently inside `planChartsAndKpis`'s local
variable and appears in a log line (aggregate counts only), never as a
stored document field. `diagnostics.chartOpportunityAudit`/
`diagnostics.chartSelectionAudit` live in this same document.

**`project_impact_stories`** (the narrative overlay) is entirely separate
and holds only `impactCatalog`/`narrativeSummary`/`narrativeStatus` — no
chart-plan data at all. `composeProjectImpactStoryRecord` merges both
documents at read time into the single record shape the frontend consumes.

## 13. Rendering: chart type to component

`ProjectImpactStoryChart` (`ia_webapp`) dispatches purely on
`chart.chartType`: `"bar"`/`"comparison"` → `ProjectImpactStoryBarChart`
(the same component for both types); `"distribution"` →
`ProjectImpactStoryDistributionChart`; `"pie"` →
`ProjectImpactStoryPieChart`; `"line"` → `ProjectImpactStoryLineChart`. An
unrecognized `chartType` renders nothing — since
`PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES` is a closed, backend-enforced
set (§4, §8), this default case is effectively unreachable in practice,
not a real fallback path. See `CURRENT_ANALYTICS_PIPELINE.md` Stage 6 for
full rendering order (banner, KPI row, goal-progress chart, then the
two-column drag-and-drop dashboard grid) — this document stops at "which
component renders which chart type."

## 14. Cost / rate-limit notes worth knowing before changing this

- Same rate limit as the narrative call and every other kickoff on this
  feature: 12 kickoff requests / authenticated user / 10 minutes
  (`processingKickoffRateLimitConfig`) — applied at the route level to
  triggering the whole job, not separately to chart-plan vs. narrative.
- Chart-plan's catalog is typically far larger than the narrative's
  (narrative only sees confirmed-outcome entries; chart-plan sees every
  grounded calculation, every goal assessment, and every context
  distribution across every activity) — the prompt's explicit "aim for
  10-12 charts" instruction means this call's output token count, and
  therefore cost and latency, scales with how much of a project's
  evidence is actually grounded and displayable, not with project age or
  activity count alone.
- Up to 3 total LLM calls per run (1 + 2 retries), each a full fresh
  `gpt-5-mini` completion with no wall-clock early-stop (§7) — unlike the
  V2 planner, a slow reasoning attempt here can only be bounded by the
  outer 300s HTTP timeout, not by the retry loop noticing it's running out
  of budget and stopping early.
- `temperature=0, seed=0` on every attempt — deterministic in principle
  for a fixed catalog + prompt, but a retry's prompt differs (violation
  feedback appended), so a retried attempt is not a literal repeat of the
  first.

## Document Status

This file is a narrow, mechanism-level companion to
`CURRENT_ANALYTICS_PIPELINE.md` (architecture map) and
`PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md` (the sibling narrative-call
deep dive) — all three live in this same `ia_backend/documentation/`
directory. If chart/KPI selection mechanics change, update this file (not
a new Markdown file); if the change is architecturally significant (new
catalog entry kind, new persisted field), fold a summary into
`CURRENT_ANALYTICS_PIPELINE.md`'s Stage 3 as well, the same way this
file's narrative sibling is cross-referenced there.
