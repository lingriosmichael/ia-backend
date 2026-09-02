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

**Rewritten in full 2026-08-30.** The mechanism this document describes
changed from chart _selection_ (an LLM picking from a pre-built menu of
already-computed label/value stubs) to chart _authoring_ (an LLM designing
a curated chart set from real distribution shares/values and confirmed
evidence). Everything below reflects the current, live mechanism —
`chart_authoring.py` / `chart_authoring_grounding.py` /
`projectImpactStoryChartAuthoringExecution.ts` — not the predecessor
(`chart_plan.py` / `chart_plan_grounding.py` /
`projectImpactStoryChartPlanExecution.ts`'s old top-level function), which
was deleted the same day once this path was confirmed working
end-to-end. Line numbers below are cited only where cheap to verify
directly; treat the function/file name as authoritative if a cited line
number has since drifted.

**Updated again 2026-08-31**: the system prompt quoted below gained a new
title/subtitle plain-language guidance paragraph (previously ungoverned),
and lost its `componentLabel` clause on the `components` list bullet — the
schema field itself was deleted (parsed but never actually read anywhere;
see `CURRENT_ANALYTICS_PIPELINE.md`'s 2026-08-31 note). The blockquote
below has been kept byte-verbatim with the real prompt in
`chart_authoring.py` through this change.

## 1. What this covers, and what it doesn't

This feature produces three visually distinct groups of numbers on the
Analytics tab:

- **LLM-authored**: `headlineKpis` (4 tiles) and `chartPlan` (an ordered
  list of charts) — an LLM designs which already-computed facts matter,
  how to group them into charts, and how to frame each one; it never
  computes or invents a number itself. This document is about this path
  end to end. As of 2026-08-30, `chartPlan` also carries confirmed
  `paired_categorical_shift`/`single_distribution` outcome evidence, mixed
  in alongside grounded-but-unconfirmed evidence — see §3.
- **Deterministic, never LLM-selected**: `goalProgressEntries` (the
  target-vs-achieved ranking), `confirmedOutcomeCharts` (the confirmed
  `paired_delta` overview, new 2026-08-30), `backlogChartPlan` (one ready
  chart per catalog entry the LLM didn't pick), and two audit structures
  (`chartOpportunityAudit`/`chartSelectionAudit`). These are covered too
  (§9), because understanding what the LLM is and isn't responsible for
  requires seeing all of it — but none of them involve an LLM call.

Not covered here: the narrative text (`narrativeSummary`) — a completely
separate LLM call with its own grounding/catalog, documented in
`PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md`. The two calls share the
same triggering job and the same background worker, but read different
catalogs, run independently, and can fail independently of each other
(§10's ordering section shows exactly how they interleave).

## 2. What triggers this, and how it relates to the narrative call

Same trigger as the narrative call — there is exactly one user action that
produces both: clicking "Analyse aktualisieren" on the Analytics tab,
which is `POST /projects/:projectId/analytics` (alias
`/impact-story`). See `PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md` §1–2
and `CURRENT_ANALYTICS_PIPELINE.md`'s Stage 4 for the full job-creation/
worker-claim mechanics (readiness gate, existing-job dedup, the
`activityAnalysisWorker.ts` background process) — none of that differs for
chart authoring vs. narrative; both run inside the same claimed
`project_impact_story` job, in the same worker call to
`ProjectImpactStoryService.buildProjectImpactStory`.

Opening the tab (`GET /projects/:projectId/analytics`) never triggers
either LLM call — it only reads back the most recently generated result.

## 3. Building the catalog sent to the LLM

**Main files**: `ia_backend/src/modules/projectImpactStory/projectImpactStoryCatalog.ts`
(grounded entries) and `projectImpactStoryChartAuthoringRequestMapper.ts`
(the wire-shape mapper, successor to the old
`toProjectImpactStoryChartPlanRequestEntries`).

### 3a. Which run counts as "current" for an activity

`selectCurrentV2RunsByActivity` (`projectImpactStoryV2RunSelection.ts`,
full file) filters `activityAnalysisRuns` to `status === "completed"`,
then picks the most recent by `createdAt` per `activityId`. Critically, it
then requires that run's `evidence[].uploadMetadataId` set to **exactly
equal** (same size, every id present) the activity's _current_ set of
uploads. If a completed run exists but the activity's evidence has since
changed (a new upload, or a deletion) — that run is stale for this
purpose, and the whole activity is excluded from the catalog (pushed into
an `activitiesExcludedIds` set), regardless of how good the stale run's
numbers look. An activity with no completed run at all is excluded the
same way. This exclusion feeds `chartOpportunityAudit`'s
`stale_or_missing_analysis_run`/`no_evidence_uploaded` rows (§9). This
mechanism is unchanged by the chart-authoring redesign.

### 3b. Six catalog entry kinds, two trust levels, one merged request

The internal discriminated-union catalog built by `projectImpactStoryCatalog.ts`
(`ProjectImpactStoryCatalogEntry`) is unchanged: still three grounded
kinds built there (`calculation`, `goal_assessment`, `context_distribution`)
plus a fourth (`paired_story_delta`, currently always empty — see §3e).
What changed on 2026-08-30 is what happens _after_ that catalog is built:
`projectImpactStoryChartAuthoringRequestMapper.ts`'s
`toProjectImpactStoryChartAuthoringRequestEntries` now merges it with two
of the three confirmed impact-catalog shapes before sending anything to
Python — six kinds total on the wire
(`ProjectImpactStoryChartAuthoringCatalogEntry`, a Pydantic discriminated
union on `kind`):

- `calculation`, `goal_assessment`, `context_distribution`,
  `paired_story_delta` — the four grounded kinds, unchanged in _content_
  from before (see §3c below for what changed in their _wire shape_).
- `confirmed_paired_categorical_shift`, `confirmed_single_distribution` —
  new. Mapped from `ImpactCatalogItem[]` (the confirmed-outcome catalog —
  see `CURRENT_ANALYTICS_PIPELINE.md` Stage 1 for how that catalog itself
  gets built from human-confirmed `OutcomeEvidenceLink` records).
  `unmeasured` entries are filtered out before reaching the mapper — an
  outcome with no linked evidence has nothing chartable. **Confirmed
  `paired_delta` is deliberately never mapped here** — the mapper's
  `impactCatalog.flatMap` returns `[]` for that shape explicitly, with a
  comment explaining why: it's handled entirely by a separate,
  fully-deterministic mechanism instead
  (`projectImpactStoryConfirmedPairedDeltaCharts.ts` — see §9), so sending
  it into this LLM-driven catalog too would risk it appearing twice.

The grounded-vs-confirmed split matters for framing, not just selection —
see §5's system prompt, which explicitly tells the model the two
confirmed kinds are real, human-verified evidence it may describe as
genuine measured results, while everything else is grounded-but-unconfirmed.

### 3c. Wire-shape flattening for the LLM — now carries real data, not a description stub

This is the one substantive content change from the predecessor mechanism.
The old `toProjectImpactStoryChartPlanRequestEntries` converted
`context_distribution`/`paired_story_delta` entries into a synthesized
one-line `description` string with `value: null` — the LLM never saw the
real share breakdown or the real before/after numbers, only a summary
sentence. The new mapper passes the real data straight through instead:

- `context_distribution` carries its real `shares: {label, count}[]` and
  `n` (not just a `"{dimensionLabelDe}; n=X. {sourceDe}"` description
  string).
- `paired_story_delta` carries its real `beforeValue`/`afterValue`/
  `nMatched`/`nBaseline` (not just a matched-row-count description with
  `value: null`).
- `calculation`/`goal_assessment` are functionally unchanged from before
  (a calculation's `value` was already real; a goal assessment never had
  a numeric `value` field to begin with) — **except** `goal_assessment`'s
  `label` text itself: as of a later 2026-08-30 addition (see
  `CURRENT_ANALYTICS_PIPELINE.md` Stage 3, "Display-label generation"),
  `toProjectImpactStoryChartAuthoringRequestEntries` now substitutes a
  short, separately-cached LLM-generated display label for a
  `goal_assessment` entry's full raw `goalText` when one has already been
  resolved for this run (`goalDisplayLabelsByGoalText.get(entry.goalText)`,
  falling back to the raw text if not yet resolved), so the model authors
  its own KPI tile labels from an already-short starting point instead of
  needing to shorten a full sentence itself.
- The two confirmed kinds carry their own real `beforeShares`/
  `afterShares` (paired categorical shift) or `shares`/`n` (single
  distribution) — same principle, extended to the new confirmed entries.

This is _why_ the redesign happened at all (see
`CURRENT_ANALYTICS_PIPELINE.md`'s top-of-file 2026-08-30 note and the root
`IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md`): the product owner wanted the
LLM to see the project's actual computed data and design charts around
it, not select from a menu of pre-summarized stubs it couldn't see the
real numbers behind.

### 3d. Typical catalog size

No explicit cap exists anywhere in this pipeline on catalog size sent to
the LLM — it is exactly as large as "every grounded calculation, every
goal assessment regardless of status, every context distribution, every
confirmed `paired_categorical_shift`/`single_distribution`" across every
activity with a current run plus every confirmed link. The prompt (§5) is
written to actively want a full, multi-facet selection rather than a
short highlight reel, so a larger catalog is expected to translate into
more charts, not into the model discarding most of it.

### 3e. The fourth grounded kind: `paired_story_delta` (currently always empty)

`buildProjectImpactStoryPairedStoryDeltaCatalog`
(`projectImpactStoryPairedStoryDeltaCatalog.ts`) unconditionally returns
`[]` as of 2026-08-27 — the declared-pairing detection mechanism it
depended on was removed by the outcome-evidence merge (see
`OUTCOME_EVIDENCE_MERGE_PLAN.md`). Its (currently always empty) result is
concatenated onto the real catalog inside `assertReadyForImpactStoryRun`:
`fullCatalog = [...catalog, ...pairedStoryDeltaCatalog]` — this is the
`fullCatalog` that both the chart-authoring request and every
deterministic sibling mechanism (§9) actually consume. The type and every
consumer are kept alive only because historical, already-generated
snapshots from before 2026-08-27 may still contain real
`paired_story_delta` charts that need to keep rendering — see
`CURRENT_ANALYTICS_PIPELINE.md` Stage 3 for the full story of this
permanent disablement. Unaffected by the chart-authoring redesign.

## 4. The chart-authoring LLM call

**Route**: `POST /internal/project-impact-story/chart-authoring` (Python)
— the only chart-selection route; the predecessor,
`/internal/project-impact-story/chart-plan`, was deleted 2026-08-30.

**Call chain**: `ProjectImpactStoryService.planChartsAndKpis` (backend,
called from `buildProjectImpactStory` — see the exact ordering in §10) →
`pythonProcessingClient.planProjectImpactStoryChartAuthoring` → the route
above → `plan_project_impact_story_chart_authoring` (`chart_authoring.py`).

**Request** (`ProjectImpactStoryChartAuthoringRequest`): `{projectId,
projectName, language: "de"|"en", catalog: [...] (§3's merged, six-kind
catalog), allowedChartTypes: string[], headlineKpiCount: number}`.

**`allowedChartTypes` and `headlineKpiCount` are hardcoded TypeScript
constants**, not config and not computed:
`PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES = ["bar", "pie", "line",
"comparison", "distribution"]` and
`PROJECT_IMPACT_STORY_HEADLINE_KPI_COUNT = 4`
(both still live in `projectImpactStoryChartPlanExecution.ts`, which kept
its pre-redesign filename — see §8's opening note for why).
`projectImpactStoryService.ts` imports both and passes them straight
through unchanged.

**Auth/timeout**: shared-secret header
(`x-internal-service-token`, `authHeaders()`), timeout
`projectImpactStoryLlmTimeoutMs = 300_000` ms (`pythonProcessingClient.ts`)
— deliberately raised above the generic 120s LLM timeout because this call
runs inside the background worker job (not the live HTTP request) and
internally runs its own grounding-retry loop of up to 3 full LLM calls
(§7), observed in practice to sometimes exceed 120s. Unchanged from the
predecessor.

**Model/params** (`chart_authoring.py`'s `_propose_chart_authoring`, via
`parse_structured_chat_completion`): `model = get_settings().openai_model`
(`"gpt-5-mini"`), `temperature=0`, `seed=0`, no `reasoning_effort` override
(unlike the V2 planner, which does set one) — structured-output parsing
against `ProjectImpactStoryChartAuthoringDraft` as the `response_format`.

**Zero-catalog short-circuit**: if `request.catalog` is empty,
`plan_project_impact_story_chart_authoring` returns immediately
(`{headlineKpis: [], chartPlan: [], groundingStatus: "PASSED",
fellBackToDeterministicSelection: false, llmUsage: None}`) with **no LLM
call at all** — this is also mirrored on the backend side: if the built
merged catalog is empty, `projectImpactStoryService.ts`'s
`planChartsAndKpis` never even calls Python.

## 5. The full, verbatim system prompt

Built fresh on every attempt (retries append a violation-feedback
paragraph — see §7). This is the complete text as of `chart_authoring.py`'s
`_propose_chart_authoring`, with `{request.headlineKpiCount}` substituted
(currently always `4`):

> You design the story for an NGO project's impact dashboard from
> already-computed facts. You never compute, estimate, or invent a number
> yourself — every entry in the catalog already carries its final
> value(s), including full category breakdowns where relevant (shares).
> Your job is only to decide which catalog entries matter most, how to
> group them into charts, and how to frame each one — copying entryId
> values exactly from the input catalog, and, where you narrow a chart to
> a subset of an entry's real categories, copying those category labels
> exactly too. Never invent an entryId, category label, or number not
> shown to you.
>
> The catalog has two trust levels, and this matters for how you frame a
> chart, not just which one you pick: CONFIRMED_PAIRED_CATEGORICAL_SHIFT
> and CONFIRMED_SINGLE_DISTRIBUTION entries are real, human-verified
> outcome evidence — a person reviewed and confirmed this measurement is
> real and belongs to this project's outcomes. You may describe these as
> genuine measured results and real change over time. (A third confirmed
> shape, numeric before/after pairs, is deliberately not in this catalog
> at all — it's already shown automatically, every time, in its own
> always-visible chart before you're even asked to plan anything, so
> there's no need to represent it here.) CALCULATION, GOAL_ASSESSMENT,
> CONTEXT_DISTRIBUTION, and PAIRED_STORY_DELTA entries are grounded in
> real data but not human-confirmed as outcome evidence —
> PAIRED_STORY_DELTA in particular is a real before/after measurement no
> human has vetted yet, and must be framed neutrally (e.g. 'observed
> change'), never as proof of impact or effectiveness. CONTEXT_DISTRIBUTION
> entries are valid supporting evidence for scene-setting or subgroup
> breakdowns, not proof of outcome change by themselves.
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
> the whole project — reach, process, results, and confirmed outcomes —
> not a highlight reel of only the two or three single strongest facts. A
> funder or board reader wants the fuller picture: how people were
> reached, what the project actually ran, and what changed. Aim for at
> least 8 charts, ideally 10 to 12, whenever the catalog has this much
> ready material — do not stop at 3 to 5 just because a handful of facts
> feel like the clear highlights. Every CONFIRMED_* entry is real, vetted
> evidence and deserves a genuine place in the story, not an afterthought
> — give it a clear title and, where it fits naturally, group it with
> related entries rather than leaving it generic. Only fall short of the
> 8-12 range if the catalog genuinely does not have enough distinct, real
> facts to support it — never by choice when it does.
>
> To reach that range, actively look for one chart per distinct facet
> below rather than converging early on your favorites — treat this as a
> coverage checklist, not a ranked top-3:
>
> - Confirmed outcome evidence: every CONFIRMED_* entry, each given its
>   own clear place in the story.
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
>   something true about them before they ever encountered the project —
>   does not belong, even when its categories are well-populated. If the
>   honest answer to 'would a reader learn something about the project
>   from this chart alone' is no, leave it out.
> - Bottlenecks or drop-off between stages, if the catalog supports it.
> - A behavior/next-step distribution, if the catalog supports it.
> - The same measure compared side by side across activities, where the
>   comparability rules below allow it.
> - Change over time, for every calculation that has period-based data,
>   not just one.
> - A plain 'goals achieved vs not achieved' status chart, once.
>
> Skip a facet only when the catalog genuinely has nothing real to say
> there, never to keep the total count low.
>
> Never propose two charts that visualize the same underlying set of
> catalog entries, or that differ only cosmetically.
>
> Choose the chart type by what it needs to show, not by habit:
>
> - 'pie': check this first for any breakdown that is a genuine
>   part-to-whole of one coherent group. Use it whenever that group has
>   at most 4-5 segments with clearly different sizes and short labels.
>   Never use it for close values or a ranking/comparison that is not
>   really one whole.
> - 'distribution': horizontal ranked bars, for rankings, funnels, and
>   breakdowns that are not a single coherent whole, or whenever a
>   category label is longer than a short word or two.
> - 'bar' or 'comparison': vertical bars, for comparing 2 (at most 3)
>   genuinely distinct, independent measures side by side, or a confirmed
>   before/after pair, where every label is short.
> - 'line': change over time from period-based data only.
>
> Write every `title` and `subtitle` as plain-language dashboard copy for
> a non-technical funder or board reader, never a restatement of a field,
> tool, or column name. Title: at most about 8 words, concrete about what
> happened or what was measured, active voice, never repeating the
> chart's own number (the number is already shown on the chart).
> Subtitle: one short clause of real context the title doesn't already
> give — not a restatement of the title, not raw technical wording.
> Apply the same confirmed-vs-unconfirmed framing rules above to this
> wording too.
>
> A chart's `components` list says which entries it visualizes, each with
> an optional `shareFilter` (a subset of that
> entry's own real category labels, copied verbatim, to narrow what's
> shown — omit it to show every category). What a chart's components may
> combine depends on kind, not on what would make a good story — a chart
> whose components mix kinds that cannot actually combine will be
> silently dropped instead of rendered, wasting the slot:
>
> - A CONTEXT_DISTRIBUTION or PAIRED_STORY_DELTA entry renders alone —
>   one component per chart for these, never combined with anything
>   else, even each other.
> - GOAL_ASSESSMENT entries may be grouped together (e.g. by status).
> - CALCULATION entries may only combine with each other under the
>   sum/average comparability rule above.
> - Exactly two entries of the same share-bearing kind
>   (CONTEXT_DISTRIBUTION+CONTEXT_DISTRIBUTION, or
>   CONFIRMED_SINGLE_DISTRIBUTION+CONFIRMED_SINGLE_DISTRIBUTION) may
>   combine into one side-by-side comparison chart only when they measure
>   genuinely the same real-world categories (e.g. the same question
>   asked of two different groups) — never combine two unrelated
>   breakdowns just because both happen to have shares.
> - A confirmed entry (CONFIRMED_*) may never combine with an unconfirmed
>   entry (CALCULATION, GOAL_ASSESSMENT, CONTEXT_DISTRIBUTION,
>   PAIRED_STORY_DELTA) in the same chart — confirmed evidence must stay
>   visually and structurally distinct from evidence no human has vetted.
> - Never mix different unconfirmed kinds in the same chart's components
>   either.
>
> Confirmed-entry chart types are restricted too, same
> silently-dropped-if-wrong rule: CONFIRMED_PAIRED_CATEGORICAL_SHIFT only
> ever renders as 'comparison' or 'bar' (a before/after shift is never a
> pie or a real time series). CONFIRMED_SINGLE_DISTRIBUTION, alone or
> combined with a second comparable one, only ever renders as 'pie',
> 'distribution', or 'bar'.
>
> Prefer charts over KPI tiles whenever a distribution, comparison, or
> trend would tell the story better than a single number.
>
> If a KPI or chart cannot be grounded in real catalog entries, leave it
> out rather than forcing it.

Appended to the system message (not the text above; a separate string
concatenated on): `Write every user-facing label/title/reason in
{language_name}.` — the same language-instruction pattern used by the
narrative call and the V2 planner.

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

`chart_authoring.py`'s `_propose_chart_authoring`:

```
Project: {request.projectName}

Allowed chart types: {', '.join(request.allowedChartTypes)}

Catalog entries:
{one line per catalog entry, formatted per kind below}
```

Each catalog entry is rendered as exactly one line via `_describe_entry`,
by kind:

- **calculation**: `- [{entryId}] CALCULATION "{label}" = {value}` (the
  `= {value}` segment omitted entirely if `value is None`)
  ` (tool: {toolName}, unit: {unit}, activity: {activityName}). {description}`
- **goal_assessment**: `- [{entryId}] GOAL_ASSESSMENT ({goalType}) "{label}": status={assessmentStatus}, achieved={achieved} (activity: {activityName})`
- **context_distribution**: `- [{entryId}] CONTEXT_DISTRIBUTION "{label}" (activity: {activityName}, n={n}): {shares as "label=count, label=count, ..."}. {description}`
  — new: the real `shares` are rendered inline (via `_format_shares`),
  where the predecessor only ever sent a one-line `description` summary
  with no share detail at all.
- **paired_story_delta**: `- [{entryId}] PAIRED_STORY_DELTA "{label}" (activity: {activityName}): before={beforeValue}, after={afterValue}, matched={nMatched} (of {nBaseline} baseline). {description}`
  — new: the real `beforeValue`/`afterValue` are rendered inline, where
  the predecessor only ever sent a matched-count description with no
  numbers.
- **confirmed_paired_categorical_shift** (new): `- [{entryId}] CONFIRMED_PAIRED_CATEGORICAL_SHIFT "{pairLabel}" for outcome "{outcomeStatement}" ({outcomeTerm}-term): before: {shares}; after: {shares}; matched={nMatched} (of {nBaseline} baseline).`
- **confirmed_single_distribution** (new): `- [{entryId}] CONFIRMED_SINGLE_DISTRIBUTION "{questionLabel}" for outcome "{outcomeStatement}" ({outcomeTerm}-term): n={n}: {shares}.`

`_format_shares` renders an entry's real `shares` as
`"label1=count1, label2=count2, ..."`, or the literal string `"no data"`
for an empty list.

If the catalog is non-empty but happens to summarize to nothing (never
actually reachable given the zero-catalog short-circuit in §4, but
defensively handled): `_summarize_catalog` returns the literal string
`"No catalog entries available."` when passed an empty list.

## 7. The checker, retry loop, and fallback

**File**: `app/project_impact_story/chart_authoring_grounding.py`
(`validate_chart_authoring_output`) — successor to
`chart_plan_grounding.py` (deleted 2026-08-30), same scope and same split.

Unlike the narrative call's checker (which validates free-text number
grounding — see the narrative doc's §6), this schema carries **no numeric
`value` field anywhere** the model could invent — it only ever _selects_
`entryId`s and, at most, a `shareFilter` of real labels. So this checker
is almost entirely referential-integrity and well-formedness, not
number-matching:

- exactly `expected_headline_kpi_count` (4) headline KPIs, or a violation
- no duplicate `kpiId` / `chartId` values
- every KPI/chart references at least one `entryId`
- every referenced `entryId` must exist in the real catalog — any unknown
  id is a violation (`sorted(unknown_ids)` reported)
- a `single`-aggregation KPI must reference exactly one entry
- every chart's `chartType` must be in `allowed_chart_types`
- **new (2026-08-30): `shareFilter` label existence.** For every
  component with a non-empty `shareFilter`, every listed label must exist
  among that entry's own real share labels (`_real_share_labels` —
  applies to `context_distribution`, `confirmed_single_distribution`, and
  the union of before/after labels for `confirmed_paired_categorical_shift`;
  any other kind has no shares to filter, and setting `shareFilter` on one
  is itself a violation). This is checked here because it's the same
  class of check as "does this entryId exist" — the catalog entry's own
  real labels are right here to check against. **Not** checked here: the
  numeric safety limit on how much of an entry's data a filter may hide —
  that's a judgment call about real data, so it's `ia_backend`'s job (§8).
- **the one text-content check this stage owns**: for any chart where at
  least one resolved component's entry has `kind == "paired_story_delta"`,
  the chart's `title` and `narrativeReason` are run through
  `contains_causal_language` (shared with the narrative checker — a
  fixed-phrase, case-insensitive, whole-word regex check across both
  English patterns — `caused`, `cause of`, `led to`, `leads to`, `resulted
in`, `resulting in`, `because of`, `due to` — and German patterns —
  `verursacht`, `verursachte`, `führte zu`, `führten zu`, etc. — checked
  regardless of the request's own language, as cheap defense against
  accidental code-switching). A hit is a violation: an unconfirmed
  before/after pair must never be described with causal/effectiveness
  language. This check deliberately does **not** apply to a chart built
  from a confirmed entry — those are real, human-verified change, and may
  legitimately be described that way.

Deliberately **not** checked here (the file's own header comment is
explicit about this split): whether entries combined into one KPI/chart
are _structurally_ comparable (same `toolName`/`unit`/`denominatorType`
for calculations; compatible real category sets for two share-bearing
entries; the hard confirmed/unconfirmed separation) — that domain-specific
gate is `ia_backend`'s job (`projectImpactStoryChartAuthoringExecution.ts`,
§8 below), mirroring the same "Python plans, backend executes" split
`CURRENT_ANALYSIS_PIPELINE.md` documents for the V2 planner.

**Retry loop**: the same shared `run_with_grounding_retries` helper the
V2 planner and narrative call use (`app/analytics/grounding_retry_loop.py`
— full mechanics: propose → validate → on failure, feed violation reasons
back into the next `propose` call as plain strings). Chart-authoring's own
constant: `_MAX_GROUNDING_RETRIES = 2`, i.e. **up to 3 total LLM calls**
(1 initial + 2 retries) — unchanged from the deleted predecessor
`chart_plan.py`'s value, and deliberately unaffected by the separate,
narrower narrative-grounding retry-removal decision (`narrative.py`'s
`_MAX_GROUNDING_RETRIES` dropped to `0` the same day — see the narrative
doc's §6a — because _that_ call's context payload is far larger and more
expensive to resend on every retry; this call's context is not, so a
corrective re-prompt stays cheap by comparison). No
`max_wall_clock_seconds` budget is passed into the shared loop — every
attempt always runs to completion, bounded only by the outer 300s HTTP
timeout (§4).

**On exhaustion** (`on_exhausted` in `chart_authoring.py`):
`_fallback_chart_authoring(catalog, headline_kpi_count)` — a
deterministic, no-LLM, in-process fallback distinct from `ia_backend`'s
own emergency fallback (§11 covers the difference). It filters `catalog`
to `kind == "calculation" and value is not None`, takes the first
`headline_kpi_count` such entries in catalog order (**not** a real
relevance ranking — the function's own docstring calls this out
explicitly, "deliberately simple... same honesty as curation.py's
`_fallback_selection`"), and builds one `single`-aggregation KPI per entry
with a fixed `narrativeReason: "Deterministic fallback selection."` and
`kpiId: f"fallback-kpi-{index}"`. **It never produces any `chartPlan`
entries** — `chartPlan: []` always. The response is returned with
`groundingStatus: "FAILED"`, `fellBackToDeterministicSelection: True`.
Confirmed evidence isn't specially handled by this fallback at all — the
function's own docstring is explicit that `ia_backend`'s own
mandatory-inclusion pass (§8) is the real safety net that guarantees
confirmed entries always reach the dashboard regardless of what this
in-Python fallback does.

Note this Python-side fallback still requires the _call itself_ to have
succeeded 3 times and failed grounding each time — it is unrelated to
`ia_backend`'s fallback (§11), which triggers only when the whole HTTP
call throws.

## 8. Backend execution: nothing from Python is trusted as a resolved fact

**Main file**: `ia_backend/src/modules/projectImpactStory/projectImpactStoryChartAuthoringExecution.ts`
(`executeProjectImpactStoryChartAuthoring` and helpers) — successor to
`projectImpactStoryChartPlanExecution.ts`'s old top-level
`executeProjectImpactStoryChartPlan`, deleted 2026-08-30 once this path
was confirmed working end-to-end. **`projectImpactStoryChartPlanExecution.ts`
itself still exists and is still imported** — it kept its pre-redesign
filename, but its role narrowed to a shared library of deterministic
building blocks (`buildChartData`, `asComparableCalculationKpis`,
`buildKpi`, `resolveEntries`, `buildPairedStoryDeltaLabels`, the
context-distribution chart-type gates, `buildChartEntryIdSetSignature`,
the two allowlist constants from §4) that both
`projectImpactStoryChartAuthoringExecution.ts` and
`projectImpactStoryChartBacklog.ts` import — exactly the same computation
either the old or new execution path used.

Every one of the following is **re-derived from `ia_backend`'s own copy
of the catalog**, never trusted from Python's response body.

### 8a. entryId re-resolution — now against a merged map

`resolveMergedEntries`: every chart candidate's `components[].entryId`
list is looked up against one `Map<string, ChartAuthoringEntry>` built
from **both** the grounded catalog and the confirmed impact catalog
together (`ChartAuthoringEntry = ProjectImpactStoryCatalogEntry |
ImpactCatalogItem`, distinguished at runtime by `isConfirmedEntry` — a
confirmed entry is any object with a `shape` field, a grounded one has
`kind` instead). If **any** id fails to resolve, the whole chart
candidate is discarded — same defense-in-depth reasoning as before: this
backend copy of the catalog is the actual source of truth, so it
re-checks rather than trusting Python's own grounding check (§7) alone.
Headline KPIs are handled separately and more narrowly: `buildKpi` only
ever resolves against the **grounded-only** map — a confirmed shape has
no single aggregable scalar the way a calculation/goal_assessment does
(a `paired_delta` is two numbers, a distribution is a set of shares), so
a KPI candidate that references a confirmed `entryId` simply fails to
resolve, the same "unknown entry" path `buildKpi` already had.

### 8b. The hard confirmed/unconfirmed separation rule (new)

Once a chart candidate's components resolve, `buildAuthoredChart` counts
how many of the resolved entries are confirmed
(`entries.filter(isConfirmedEntry).length`). If that count is greater
than zero but less than the total entry count — a mix — **the whole chart
is rejected outright**, regardless of chart type or how the model framed
it. This is the mechanism behind the prompt's "a confirmed entry may
never combine with an unconfirmed entry" instruction — a hard backend
rule, not merely a prompt request the checker also happens to enforce.
The two trust tiers can appear side by side on the dashboard (as separate
chart cards), never blended into what looks like one homogeneous chart.

### 8c. Grounded-only charts — delegates to the reused predecessor logic

If every resolved entry is unconfirmed, execution delegates straight to
the same logic the old `executeProjectImpactStoryChartPlan` already had
(via the shared helpers in `projectImpactStoryChartPlanExecution.ts`):
the single-`context_distribution` chart-type eligibility gate
(`isAllowedContextDistributionChartType`), the single-`paired_story_delta`
chart-type restriction (`isAllowedPairedStoryDeltaChartType`,
`comparison`/`bar` only), `buildChartData` for the actual datum
construction (including `asComparableCalculationKpis`'s structural
comparability gate — same `toolName`/`unit`/`denominatorType` — for
multi-entry calculation charts), and the pie-vs-distribution override for
context distributions (`resolveContextDistributionChartType`,
`isPartToWholeShape` — pie is forced when 2–5 non-zero segments exist
with ≥30% spread between largest and smallest, and downgraded to
`distribution` when the LLM picked pie but the data doesn't qualify).
None of this logic changed — only its caller did.

### 8d. Confirmed-only charts — new logic

If every resolved entry is confirmed:

- **Single entry.** `unmeasured`/`paired_delta` never reach this branch in
  practice (`unmeasured` has nothing to chart and is filtered before the
  request is even built; `paired_delta` is never mapped into the catalog
  at all — see §3b) — the check here is defense in depth, not a real
  path. For the two shapes that do reach it,
  `isAllowedConfirmedChartType` restricts chart type:
  `paired_categorical_shift` → `comparison`/`bar` only;
  `single_distribution` → `pie`/`distribution`/`bar`. Datum construction
  is `buildConfirmedSingleEntryChartData`: a categorical shift becomes two
  groups of bars, `group: "before"`/`"after"` tagged (see §9's
  `ProjectImpactStoryChartDatum.group` note) and labeled
  `` `${beforeLabel}: ${shareLabel}` ``/`` `${afterLabel}: ${shareLabel}` ``,
  after applying the component's `shareFilter` (via `applyPairedShareFilter`
  — see §8f) identically to both before and after share sets so a category
  shown on one side is never silently hidden on the other; a single
  distribution becomes one bar per (filtered) share, unfiltered `label`/
  `value` pairs.
- **Exactly two entries.** Only allowed when both are
  `single_distribution` **and** their real category-label sets are
  comparable after normalization (`haveComparableShareLabelSets` — trim/
  lowercase/collapse-whitespace, then either identical or one a subset of
  the other; empty label sets never qualify) **and** the chart type passes
  `isAllowedConfirmedChartType("single_distribution_comparison", ...)`
  (`distribution`/`bar` only — deliberately narrower than the single-entry
  case, no `pie`, since two independent snapshots side by side aren't a
  part-to-whole of one group). Datum construction
  (`buildTwoEntryDistributionComparisonChartData`) renders as
  `dataKind: "activity"` (the same cross-activity-comparison semantic
  `buildChartData` already uses elsewhere, reused here rather than
  invented fresh) — deliberately **not** the before/after
  `group` coloring, since there's no before/after relationship between two
  independent groups. Each entry's own `shareFilter` is intentionally
  **not** applied in this two-entry path — combining two independent
  filters across two sources safely was judged out of scope; a
  component-level `shareFilter` is only honored on a single-entry chart.
- **More than two confirmed entries** — never allowed, full stop. Every
  confirmed shape either stands alone or pairs with exactly one other
  comparable `single_distribution`.

Every accepted confirmed chart is marked `isConfirmedEvidence: true` on
the resulting `ProjectImpactStoryChartSpec` — see
`impactStoryConfirmedEvidenceBadge.tsx` on the frontend for the visual
marker this drives.

### 8e. What "silently dropped" means in practice

When a KPI candidate fails resolution or the comparability gate,
`buildKpi` returns `null`; the caller increments an in-memory
`droppedKpiCount` and simply omits the candidate — **there is no
per-candidate reason code kept anywhere**, only this aggregate count. The
same applies to chart candidates via `buildAuthoredChart` and
`droppedChartCount`. Both counts are logged (not persisted on the record)
by `planChartsAndKpis`'s completion log line, alongside
`selectedEntryCount`. Nothing in `ProjectImpactStoryDiagnostics` records
_why_ a specific candidate was dropped — the closest available signal for
"this looked ready but didn't show up" is `chartSelectionAudit` (§9),
which answers a related but distinct question (an entry that was
`ready_now` per the opportunity audit but never ended up in any accepted
KPI/chart), not "this specific LLM-proposed chart was rejected and here's
why." Unchanged from the predecessor.

### 8f. `shareFilter` — narrowing an entry's own real categories, with a majority-mass guard

**New in the chart-authoring redesign.** A component's `shareFilter`
(when present and referencing real labels — Python's own checker already
confirmed that, §7) is applied via `applyShareFilter`/
`applyPairedShareFilter`: labels are matched by the same
trim/lowercase/collapse-whitespace normalization
`outcomeEvidenceApprovalSafetyCheck.ts` already uses elsewhere in this
codebase, and shares are always rendered in the entry's own canonical
order — **never the order the model listed labels in**, which would let a
reordering imply a false trend. If applying the filter would keep less
than half of the entry's total count mass
(`MIN_SHARE_FILTER_KEPT_MASS_FRACTION = 0.5`), the filter is **rejected
outright and the entry falls back to showing every share** — this guards
against a filter making a minority segment look proportionally larger
than it actually is by hiding the majority.

### 8g. Goal-progress dedup

When every resolved entry in a chart candidate is `kind ===
"goal_assessment"` **and** the caller-supplied `hasGoalProgressChart` flag
is `true` (this is `goalProgressEntries.length > 0`, computed _before_
chart authoring runs at all — see §9), the candidate is dropped
unconditionally — the deterministic goal-progress ranking (§9) already
covers this ground, so the LLM's own "goals by status" chart would be a
near-duplicate. If `hasGoalProgressChart` is `false` (no goal has a
resolvable measured/target ratio at all), the same candidate instead
builds a real `dataKind: "status"` bar chart grouping goals by
`assessmentStatus` — this is the _only_ circumstance under which that
particular LLM-selected chart survives. Unchanged from the predecessor
(reused via `buildChartData`).

### 8h. Chart-level dedup by component-entryId set

`buildChartEntryIdSetSignature` = the sorted, deduplicated, pipe-joined
set of a chart's component `entryId`s (order-independent — same function
as before, now fed `components.map(c => c.entryId)` instead of a flat
`entryIds` array). A later candidate whose signature exactly matches an
_already-accepted_ chart's signature is dropped, regardless of its own
title/subtitle/chart type. Signatures are recorded only after successful
acceptance — a candidate rejected for an unrelated reason (e.g. failed
comparability gate) never blocks a later, different candidate that
happens to reuse part of its entry set.

### 8i. Mandatory-inclusion pass — the guarantee confirmed evidence never silently disappears (new)

After every chart candidate has been processed, `executeProjectImpactStoryChartAuthoring`
loops over the full confirmed impact catalog one more time. For every
entry that is not `unmeasured`, not `paired_delta` (that shape's own
guarantee comes entirely from a separate, unconditional mechanism — see
§9), and not already present in `selectedEntryIds`, it synthesizes a
single-entry chart deterministically (`buildMandatoryInclusionChart` —
the same `buildConfirmedSingleEntryChartData` datum logic as §8d, with a
fixed chart type: `distribution` for `single_distribution`, `comparison`
for `paired_categorical_shift`) and appends it to `chartPlan`, marked
`isConfirmedEvidence: true`, with `chartId:
`mandatory-inclusion:${entryId}``. This is the 2026-08-30 product
decision's actual enforcement point: **a human-confirmed measurement can
never silently disappear from the dashboard because of an LLM judgment
call** — the LLM controls a confirmed entry's title/chart-type/grouping/
framing when it does cover the entry, never its existence.

### 8j. `selectedEntryIds` — the real output that feeds everything downstream

The union of every `entryIds`/`components[].entryId` string from every
candidate that was **actually accepted** into the final
`headlineKpis`/`chartPlan` — including entries added by the
mandatory-inclusion pass (§8i). Not every id Python requested. This is
what `projectImpactStoryChartBacklog.ts` and `projectChartSelectionAudit.ts`
both consume (§9); it is the single source of truth for "was this fact
used anywhere on the dashboard this run."

## 9. Deterministic siblings — never subject to LLM selection

Six distinct mechanisms decide chart-worthy content with no LLM call of
their own. Four of the six (`goalProgressEntries`,
`confirmedOutcomeCharts`, `chartOpportunityAudit`, and the exploratory
`paired_story_delta` catalog itself, §3e) are computed **before** the
chart-authoring LLM call even runs; the other two
(`backlogChartPlan`/`chartSelectionAudit`) run after, since they need
`selectedEntryIds`. See the exact order in §10.

- **`goalProgressEntries`** (`projectImpactStoryGoalProgress.ts`,
  `buildProjectImpactStoryGoalProgressEntries(fullCatalog)`) — built from
  the catalog's `goal_assessment` entries only, entirely independent of
  chart-authoring selection. Skips a goal if `measuredValue`/`targetValue`
  is null, `targetValue === 0`, `achieved === null`, or a zero-measured
  ceiling goal (`comparison === "at_most" && measuredValue === 0`, to
  avoid a divide-by-zero). Computes `status` via the same
  `computeGoalStatus` chart-authoring execution uses, and
  `progressPercent = round(ratio * 100)` (can exceed 100). Always
  rendered on the frontend whenever non-empty — no selection step at all.
  Its only interaction with the LLM path is one-directional:
  `goalProgressEntries.length > 0` becomes the `hasGoalProgressChart`
  flag passed into chart-authoring execution (§8g). Unaffected by the
  redesign.
- **`confirmedOutcomeCharts`** (new, 2026-08-30,
  `projectImpactStoryConfirmedPairedDeltaCharts.ts`,
  `buildProjectImpactStoryConfirmedPairedDeltaCharts(impactCatalog,
language)`) — the confirmed `paired_delta` shape's own tier, entirely
  outside the LLM catalog. Splits confirmed `paired_delta` entries by
  `scaleDirection`: every entry that isn't `lower_is_better` is combined
  onto one shared, `group: "before"|"after"`-colored overview chart
  (`chartId: "confirmed-paired-delta-overview"`, one `before` datum and
  one `after` datum per entry, labeled `` `${pairLabelDe} —
${beforeLabel|afterLabel}` ``); each `lower_is_better` entry gets its
  own standalone chart instead (`chartId:
`confirmed-paired-delta:${entryId}``), since mixing a reverse-scored
  measure onto the shared "higher is better" axis would misrepresent it.
  Persisted as the new `confirmedOutcomeCharts` field on
  `ProjectImpactStoryRecord`, rendered unconditionally by
  `projectImpactStoryPage.tsx` whenever non-empty — same guarantee
  `goalProgressEntries` has. **Why this exists as its own deterministic
  mechanism rather than a chart-authoring catalog kind**: showing every
  confirmed `paired_delta` pair together, colored by before/after, was
  previously an LLM-adjacent concern with no real structural signal (a
  `paired_delta` entry has no `toolName`/`unit` the way a `calculation`
  entry does) to check whether two pairs are on a genuinely comparable
  scale before combining them. Making it fully deterministic sidesteps
  needing that signal at all. **Known, accepted limitation** (explicit
  2026-08-30 product decision, not an oversight): the shared chart still
  plots every included pair's raw before/after values on one axis with no
  check that their scales are actually comparable in magnitude — a 1-5
  Likert pair could still share an axis with a raw headcount pair. If
  this proves misleading in practice on a real project, the fix is a real
  per-pair scale/unit signal, not a heuristic.
- **`chartOpportunityAudit`** (`projectChartOpportunityAudit.ts`,
  `buildProjectChartOpportunityAudit(...)`) — also computed before chart
  authoring runs. Reuses the same entryId builders as the real catalog so
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
  > skipped here. Unaffected by the redesign — does not (yet) track the two
  > confirmed shapes chart authoring can now select.
- **`chartSelectionAudit`** (`projectChartSelectionAudit.ts`,
  `buildProjectChartSelectionAudit(opportunityAudit, selectedEntryIds)`)
  — computed _after_ chart-authoring execution, since it needs
  `selectedEntryIds` (§8j). Filters the opportunity audit to `ready_now`,
  then to entries **not** in `selectedEntryIds` — literally "available and
  materialized, but the chart planner didn't put it anywhere." A
  "high-signal" subset (only `context_distribution`/`calculation` kinds —
  goal assessments and paired-story-deltas excluded from this narrower
  subset) generates human-readable `selectionWarnings` strings: `` `"${title}"
(${activityName}) was ready but not selected into any chart or KPI.` ``.
  Both audits are computed from one generation run's own data and never
  recomputed later against since-changed data.
- **`backlogChartPlan`** (`projectImpactStoryChartBacklog.ts`,
  `buildProjectImpactStoryChartBacklog(catalog, selectedEntryIds,
language)`) — computed _after_ chart-authoring execution (needs
  `selectedEntryIds`). Iterates every **grounded** catalog entry not
  already selected and builds one ready-to-render chart, reusing the
  exact same `buildChartData`/`resolveContextDistributionChartType`
  helpers chart-authoring execution itself uses (not a separate rendering
  path, and not extended to confirmed entries — those have their own
  mandatory-inclusion guarantee instead, §8i): a `context_distribution`
  entry gets the same pie-override logic (seeded with `"distribution"` as
  the default); a `paired_story_delta` entry always becomes a
  `"comparison"` chart with `isExploratory: true`; a `calculation` entry
  only produces a backlog chart if its tile is `category_rank` (→
  `"distribution"`) or `line_series` (→ `"line"`) — a plain scalar KPI
  tile produces nothing, since a single-number backlog "chart" isn't
  meaningful. `goal_assessment` entries deliberately never produce
  backlog charts — they already live in the goal-progress ranking or read
  better as a KPI. Chart ids are prefixed `` `backlog:${entryId}` `` so
  they can never collide with an LLM-chosen or deterministic chart id.
  The Analytics tab's backlog panel lets a viewer add any of these
  instantly (see `CURRENT_ANALYTICS_PIPELINE.md` Stage 6 for the UI
  side).

## 10. Exact ordering inside one generation run

All of the following happens inside one call to
`ProjectImpactStoryService.buildProjectImpactStory`, itself invoked by
`activityAnalysisWorker.ts` after claiming a `project_impact_story`
processing job:

1. `assertReadyForImpactStoryRun` runs first. Inside it, in order:
   a. Activity/upload/run context loaded; activity cards assembled.
   b. **`buildProjectImpactStoryCatalog`** — the grounded catalog (§3) is
   built.
   c. The confirmed impact catalog (`impactCatalog`, from confirmed
   `OutcomeEvidenceLink` records) is built — used by the narrative call,
   the deterministic `confirmedOutcomeCharts` mechanism, **and** (as of
   2026-08-30) merged into the chart-authoring request via
   `toProjectImpactStoryChartAuthoringRequestEntries` (§3b).
   d. `pairedStoryDeltaCatalog` (§3e, always `[]`) is built and
   concatenated onto the grounded catalog → `fullCatalog`.
   e. **`goalProgressEntries`** is built from `fullCatalog` — before any
   LLM call.
   f. **`chartOpportunityAudit`** is built — also before any LLM call,
   from the same run data.
2. Back in `buildProjectImpactStory`: catalog counts are logged.
3. **`planChartsAndKpis` runs** — this is the call that reaches Python
   (§4–§7) and then immediately runs
   `executeProjectImpactStoryChartAuthoring` (§8) on the response,
   passing in `hasGoalProgressChart = goalProgressEntries.length > 0`
   (computed back in step 1e). **This is the one moment in the whole
   pipeline where an LLM actually chooses which facts become which
   charts** — everything else in this section is deterministic.
4. **`confirmedOutcomeCharts` is built** (§9,
   `buildProjectImpactStoryConfirmedPairedDeltaCharts`) — from the
   confirmed impact catalog's `paired_delta` entries, no LLM call, never
   subject to step 3's outcome either way.
5. **`backlogChartPlan`** is built (§9), using
   `chartPlanResult.selectedEntryIds` from step 3.
6. **`chartSelectionAudit`** is built (§9), diffing step 1f's opportunity
   audit against step 3's `selectedEntryIds`.
7. **The snapshot is persisted** (`project_analytics_snapshots`) —
   `headlineKpis`, `chartPlan`, `backlogChartPlan`, `confirmedOutcomeCharts`,
   `goalProgressEntries`, and `diagnostics.{chartOpportunityAudit,
chartSelectionAudit}` are all written here, together, in one document.
   This happens **before** any narrative work. (The old `contextCharts`
   fallback field that used to sit here was deleted 2026-08-30 — see
   `CURRENT_ANALYTICS_PIPELINE.md`'s top-of-file note for why.)
8. If `impactCatalog.length === 0`, the function returns immediately
   after step 7 — no narrative call, `overlay: null`. **Everything above
   (chart authoring included) already happened and is already persisted**,
   independent of whether the project has any confirmed outcome evidence
   at all.
9. Otherwise, narrative generation runs (a completely separate LLM call —
   see `PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md`) and a second
   document, the overlay (`project_impact_stories`), is persisted
   referencing the snapshot from step 7.

**Failure isolation**: a chart-authoring failure (Python HTTP call throws
— §11) never blocks the snapshot from persisting or the narrative from
being attempted; a narrative failure never rolls back the already-
persisted snapshot. The two are independent by explicit design (comment
in `projectImpactStoryService.ts`: "chart-authoring failure and narrative
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
response still flows through `executeProjectImpactStoryChartAuthoring`
normally, since it already contains real, if simply-chosen, candidates).
It is also not invoked on the zero-catalog short-circuit (§4) — that path
never calls Python and returns empty results directly.

- **Only produces `headlineKpis` — never any `chartPlan` entries.**
- Built entirely from `catalog.filter(kind === "goal_assessment")`; if
  there are zero goal-assessment entries, returns `{headlineKpis: []}`
  (does **not** fall back further to calculation or context-distribution
  entries).
- Produces exactly 4 fixed KPIs when goal assessments exist, each with a
  hardcoded, localized label (localized via `_FALLBACK_KPI_LABELS`,
  fixed 2026-08-27/28 to actually localize — see
  `CURRENT_ANALYTICS_PIPELINE.md` Stage 3):
  1. `fallback-goals-achieved` — count where `assessmentStatus === "achieved"`.
  2. `fallback-activities-with-achieved-output` — count of distinct
     activities with at least one achieved `"output"`-type goal.
  3. `fallback-goals-not-achieved` — count where `assessmentStatus === "not_achieved"`.
  4. `fallback-evidence-coverage` — `(total - gapGoals) / total` as a
     percentage, where `gapGoals` = goals with `requires_clarification`/
     `requires_capability` status.
- This function never throws; `planChartsAndKpis` as a whole is
  documented to never throw.
- **New, 2026-08-30**: on this exact failure path,
  `projectImpactStoryService.ts` also runs
  `executeProjectImpactStoryChartAuthoring([], impactCatalog, {headlineKpis:
[], chartPlan: []}, language, hasGoalProgressChart)` — an empty LLM plan
  fed into the same execution function, so only its mandatory-inclusion
  pass (§8i) runs. This preserves the confirmed-evidence guarantee even
  through a total Python-service failure: `chartPlanResult.chartPlan`
  still ends up containing one deterministic chart per confirmed
  `paired_categorical_shift`/`single_distribution` entry, exactly as it
  would on a successful call where the LLM's own proposal simply missed
  them.

## 12. Data stores — what's persisted vs. ephemeral

**`project_analytics_snapshots`** stores the **executed, backend-computed**
output only — `headlineKpis`/`chartPlan` are the real
`ProjectImpactStoryHeadlineKpi[]`/`ProjectImpactStoryChartSpec[]` produced
by §8, not Python's raw candidate list. **Python's raw chart-authoring
response (the pre-execution `components`/`aggregation`/`chartType`
candidates, `groundingStatus`, `fellBackToDeterministicSelection`) is
never persisted anywhere** — it exists only transiently inside
`planChartsAndKpis`'s local variable and appears in a log line (aggregate
counts only), never as a stored document field.
`confirmedOutcomeCharts` (new, §9) and `diagnostics.chartOpportunityAudit`/
`diagnostics.chartSelectionAudit` live in this same document.

**`project_impact_stories`** (the narrative overlay) is entirely separate
and holds only `impactCatalog`/`narrativeSummary`/`narrativeStatus` — no
chart data at all. `composeProjectImpactStoryRecord` merges both
documents at read time into the single record shape the frontend consumes.

## 13. Rendering: chart type to component

`ProjectImpactStoryChart` (`ia_webapp`) dispatches purely on
`chart.chartType`: `"bar"`/`"comparison"` → `ProjectImpactStoryBarChart`
(the same component for both types, and the one that renders the
`group: "before"|"after"` before/after coloring both confirmed
`paired_categorical_shift` charts and `confirmedOutcomeCharts` use);
`"distribution"` → `ProjectImpactStoryDistributionChart`; `"pie"` →
`ProjectImpactStoryPieChart`; `"line"` → `ProjectImpactStoryLineChart`. An
unrecognized `chartType` renders nothing — since
`PROJECT_IMPACT_STORY_ALLOWED_CHART_TYPES` is a closed, backend-enforced
set (§4, §8), this default case is effectively unreachable in practice,
not a real fallback path. A reader tells a confirmed-evidence chart apart
from a grounded-but-unconfirmed one via
`ProjectImpactStoryChartSpec.isConfirmedEvidence`
(`impactStoryConfirmedEvidenceBadge.tsx`) and an exploratory
(`paired_story_delta`) one via `.isExploratory`
(`impactStoryExploratoryBadge.tsx`) — both are rendering-layer visual
markers, not separate components or separate page positions. See
`CURRENT_ANALYTICS_PIPELINE.md` Stage 6 for full rendering order (banner,
KPI row, goal-progress chart, `confirmedOutcomeCharts`, then the unified
`chartPlan` list, inside the two-column drag-and-drop dashboard grid) —
this document stops at "which component renders which chart type."

## 14. Cost / rate-limit notes worth knowing before changing this

- Same rate limit as the narrative call and every other kickoff on this
  feature: 12 kickoff requests / authenticated user / 10 minutes
  (`processingKickoffRateLimitConfig`) — applied at the route level to
  triggering the whole job, not separately to chart authoring vs.
  narrative.
- Chart-authoring's catalog is typically far larger than the narrative's
  (narrative only sees confirmed-outcome entries; chart authoring sees
  every grounded calculation, every goal assessment, every context
  distribution across every activity, **plus** the two confirmed shapes
  it's now merged with) — the prompt's explicit "aim for 10-12 charts"
  instruction means this call's output token count, and therefore cost
  and latency, scales with how much of a project's evidence is actually
  grounded, displayable, and confirmed, not with project age or activity
  count alone. The merge with confirmed evidence (2026-08-30) makes this
  catalog somewhat larger on average than the predecessor's, on top of
  each grounded entry's own request payload already being larger (real
  shares/values instead of a description stub, §3c).
- Up to 3 total LLM calls per run (1 + 2 retries), each a full fresh
  `gpt-5-mini` completion with no wall-clock early-stop (§7) — unlike the
  V2 planner, a slow reasoning attempt here can only be bounded by the
  outer 300s HTTP timeout, not by the retry loop noticing it's running
  out of budget and stopping early.
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
