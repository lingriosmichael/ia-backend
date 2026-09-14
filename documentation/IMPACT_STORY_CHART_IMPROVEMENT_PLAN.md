# Project Impact Story — Chart Improvement Plan (v2)

Goal: fix chart quality on the Project Impact Story "Analytics" tab —
readable labels, sensible chart selection/curation, correct source
attribution, and support for the new qualitative evidence shapes being
added elsewhere — independent of the narrative-text work tracked in
`IMPACT_STORY_NARRATIVE_IMPROVEMENT_PLAN.md`.

## Why this version exists

v1's claims were checked line-by-line against the current source
(`ia_backend`/`ia_webapp`, 2026-08-29) rather than trusted as written.
Both `[VERIFY]`s are now resolved (§0). Most claims held up exactly as
stated; two did not, and both are corrected in place rather than left to
silently drift from what the code actually does:

- **The truncation diagnosis was wrong.** v1 claimed the screenshot's
  clipped label was a CSS/container overflow effect on the full string.
  It's actually the output of an existing, deliberate 24-character JS
  truncation function already in the chart component — a different bug
  with a different set of possible fixes, including a near-zero-cost one
  v1 never considered. See §0 and §1.
- **`context_distribution`'s source caption isn't actually solved.** v1
  characterized `context_distribution` entries as "already human-facing,
  already localized" across the board. Its `labelDe`/`dimensionLabelDe`
  are — confirmed deterministic, not LLM. Its `sourceDe` is not: it's the
  identical raw-table-name problem §3 describes for the other entry
  kinds, just with a "Quelle:" prefix. §3's scope is widened accordingly.

Also added: a rollout/backfill note for §2 (existing goals have no
display label the moment this ships — the narrative plan treated the
analogous problem as a real adoption blocker, not a footnote, and this
plan should too) and a cost/latency question for the new LLM call, which
every other LLM call in this codebase's docs addresses and this plan
hadn't yet.

## Why this is a separate plan

The narrative plan and this one share the same underlying catalogs
(V2's grounded calculations/goal assessments, and — once it ships —
the new `paired_categorical_shift` evidence shape), but they're different
consumers of that data with different failure modes and different owners
of the fix. Charts can be broken in ways the narrative never surfaces
(a wall of 19 illegible bars; a raw filename in a caption; a reverse-scored
item silently plotted backwards) and vice versa. Keeping them separate
also means chart work can land on its own schedule rather than being
gated behind narrative-prompt work it has no real dependency on.

## Origin

Triggered by two screenshots of the same chart types — goal-completion
bars and paired before/after bars — from two real projects: one with few,
short goal statements (reads fine), one with many, long ones (doesn't).
Traced against `PROJECT_IMPACT_STORY_CHART_SELECTION_GENERATION.md` and
`CURRENT_ANALYSIS_PIPELINE.md` rather than left as a visual impression.
The finding: this isn't one bug, it's three independent, unrelated gaps
that happen to all hit the same screenshot at once on a large/messy
project and stay invisible on a small/tidy one.

---

## 0. What's actually happening today, traced to source

- **`goal_assessment.label` = `goalText`, verbatim, with no shortening
  step anywhere in the pipeline.** Confirmed directly in source, not just
  the chart-selection doc: `toProjectImpactStoryChartPlanRequestEntries`
  (`projectImpactStoryCatalog.ts:256`) sets `label: entry.goalText`, and
  `buildProjectImpactStoryGoalProgressEntries`
  (`projectImpactStoryGoalProgress.ts:65`) does the same for the
  goal-progress chart specifically. There is no LLM or deterministic
  rewrite anywhere between "what the NGO user typed as their goal
  statement" and "what renders as a chart's bar label."
- **[CORRECTED, was wrong in v1]: the truncated *"Mindestens 70 % der
  Tan…"* label in the screenshot is a truncation bug, not a container
  overflow.** `projectImpactStoryGoalProgressChart.tsx` already calls
  `truncateChartLabel(entry.label, MAX_CATEGORY_LABEL_LENGTH)` with
  `MAX_CATEGORY_LABEL_LENGTH = 24`; `truncateChartLabel` slices to
  `maxLength - 1` characters and appends `…`. "Mindestens 70 % der Tan"
  is exactly 23 characters — the precise output shape that function
  produces at a 24-char cap. This is almost certainly the literal output
  of that existing function, not CSS/container clipping of the full
  string. `projectImpactStoryPairedDeltaGroupChart.tsx` has its own,
  even more aggressive version of the same mechanism
  (`MAX_CATEGORY_LABEL_LENGTH = 16` on `entry.pairLabelDe`). This doesn't
  change §2's recommended permanent fix — 24 characters can't meaningfully
  summarize a full goal sentence no matter what produces the cut — but it
  means a real, near-zero-cost interim mitigation exists that v1 never
  considered: a hover tooltip showing the untruncated `goalText`, or
  simply raising the character cap, both shippable before any LLM work.
  See §1.
- **The goal-progress ranking chart has no curation step at all.**
  `goalProgressEntries` is one of the pipeline's explicit "deterministic
  siblings — never subject to LLM selection": per the chart-selection
  doc, it's "always rendered on the frontend whenever non-empty — no
  selection step at all." A project with 8 goals and a project with 19
  goals get an identically uncapped, unpaginated, unfiltered chart — one
  just happens to still be legible. Worth noting this chart currently has
  *less* discipline than the narrative sitting next to it on the same
  dashboard — the narrative's outcome paragraph already caps citations at
  5 entries; the goal-progress chart caps at nothing.
- **[VERIFY RESOLVED] A working human-*label* mechanism exists for one
  entry kind — but it solves a narrower problem than it first looks like
  it does, and its sibling *source* field is not actually solved anywhere.**
  `run.contextCatalogEntries` is built by
  `ActivityAnalysisV2Service.buildContextCatalogEntries`
  (`activityAnalysisV2Service.ts:699`). Its `labelDe`/`dimensionLabelDe`
  are confirmed **deterministic, not LLM-authored**:
  `` labelDe = `Verteilung: ${humanizeColumnName(candidate.columnName)}` ``,
  where `humanizeColumnName` (same file, line 557) is a plain
  underscore/hyphen-to-space-plus-capitalize transform on a column name —
  no model call involved. That's real and it's already working, but it
  solves "raw snake_case column name → readable label," a materially
  easier problem than "a full goal-statement sentence → a punchy 3–5 word
  display label." §2's proposed new LLM call is not actually redundant
  with this mechanism for that reason — `humanizeColumnName` has nothing
  to offer a multi-clause `goalText` sentence. §2's own scoping already
  gets this right by proposing real new work rather than assuming reuse;
  this note is here so the reasoning is explicit rather than inferred.
  **The `sourceDe` half of the same entry kind is a different story**:
  `` sourceDe = `Quelle: ${tableName}` `` (same function) — a raw table
  name with a German prefix, not a human description. This directly
  contradicts the "already human-facing, already localized" framing above
  for the source half specifically: `context_distribution` has the
  *identical* unsolved source-caption gap the next bullet describes for
  other entry kinds, it just wasn't visibly broken in the two reference
  screenshots. §3's scope is corrected accordingly.
- **[VERIFY RESOLVED] No source-caption construction exists anywhere for
  `goal_assessment`/`calculation`/`paired_delta`/`paired_story_delta`
  entries — confirmed, not just inferred from the screenshot.** Traced to
  `projectImpactStoryImpactCatalog.ts:343`:
  `` sourceDe: `Quelle: ${link.beforeTableName} → ${link.afterTableName}` ``
  (and the equivalent single-table version at line 399). That value flows
  straight into `entry.sourceDe` → `narrativeReason` in
  `projectImpactStoryImpactChart.tsx` and directly into
  `projectImpactStoryPairedDeltaGroupChart.tsx` — the exact "Vorher/
  Nachher-Vergleich" chart in the screenshot, confirming the screenshot's
  *"Quelle: 06_Wirkungsmessung_Umfrage_Miteinander im Kiez -
  Wirkungsmessung_Umfrage → 05_Baseline_Umfrage_Miteinander im Kiez -
  Baseline_Umfrage"* is a direct, unmodified table-name concatenation, as
  suspected. As noted above, the same raw-table-name pattern is also
  present on `context_distribution`'s `sourceDe` — add it to §3's scope.
- **No scale-direction ("higher is better") signal exists anywhere in the
  schema, confirmed.** `comparison` (`"at_most"` vs. default) exists
  *only* on `ActivityAnalysisV2GoalAssessmentRecord`, used solely for
  goal-vs-target ratio math — it says nothing about a raw evidence column,
  and nothing analogous exists for `paired_delta`/scale columns generally.
  The preparation-stage field that might once have been the natural home
  for this, `declared_scale_bounds`, was removed entirely in the
  outcome-evidence redesign (`OUTCOME_EVIDENCE_MERGE_PLAN.md`), and even
  before removal it never carried a direction field — this gap predates
  and is independent of that redesign. Concretely: the *"Vorher/Nachher-
  Vergleich"* chart in the screenshot plots what looks like a day-count
  item (*"Tage ohne persönlichen Kontakt…"*) on the same 0–8 axis as
  several 1–5 Likert items, with no structural signal anywhere for
  whether that item is reverse-scored. If it is, the chart currently has
  no way to know — and neither would any future automated or LLM-assisted
  grouping logic that tries to decide which items can share an axis.

---

## 1. Curation for the goal-progress ranking chart

Add an explicit curation step to (or a wrapper around)
`buildProjectImpactStoryGoalProgressEntries` — a product decision as much
as an engineering one. Confirmed against source:
`projectImpactStoryGoalProgress.ts` has no cap, no pagination, no
status-based prioritization — it filters only for data-completeness, then
pushes every eligible goal. The frontend
(`projectImpactStoryGoalProgressChart.tsx`) doesn't cap either; it sorts
by `progressPercent` **descending** and scales chart height with
`data.length * 32`, so bars won't visually overlap even at 19 goals — but
that sort order means the best-performing (already-`achieved`) goals
render first and the goals most worth a reader's attention sit at the
bottom of a long scroll, the opposite of what this section recommends.

- **[DONE]** Cap the chart at a fixed N — implemented as
  `DEFAULT_VISIBLE_COUNT = 8` in
  `projectImpactStoryGoalProgressChart.tsx`, the lower end of the plan's
  suggested 8–10 range. Prioritization is `status` (risk → warn → good),
  since `requires_clarification`/`requires_capability` goals never reach
  this chart at all — confirmed in
  `buildProjectImpactStoryGoalProgressEntries`
  (`projectImpactStoryGoalProgress.ts`), which filters out any goal
  without a resolvable
  `measuredValue`/`targetValue`/`achieved` before this chart's data is
  even built, so `good`/`warn`/`risk` is the complete set this ordering
  ever needs to handle. Within a status tier, sorted by `progressPercent`
  ascending (worst first), replacing the previous highest-progress-first
  order §1's own analysis above flagged as backwards.
- **[DONE, chosen over the plan's alternative]** Overflow handling: a
  single chart with a "+N more" text control that expands the rest in
  place (`showAll` local state), rather than grouping into per-activity
  sub-charts — decided directly with the user rather than guessed, since
  the plan explicitly left this as an open product decision. Nothing
  past the cap is ever silently dropped; the legend (`presentStatuses`)
  reflects every status present across *all* entries, not just the
  currently-visible slice, so collapsing back to 8 doesn't make a status
  color disappear from the legend inconsistently. New i18n keys
  `goalProgressShowMore`/`goalProgressShowLess` added to both `en.ts`/
  `de.ts`. Purely a frontend change — the backend already sends every
  entry; no API/contract change needed.
- This is independent of §2 below and needed either way — fixing labels
  alone would just produce 19 short, legible bars still crammed into one
  cramped chart.
- **[DONE] Cheap interim mitigation, independent of the above and shipped
  first:** per §0's corrected truncation finding, the label cutoff itself
  is an existing `truncateChartLabel(label, 24)` call, not a container
  limitation. Implemented as a hover tooltip on the truncated axis label
  (an SVG `<title>` on a custom Recharts tick component, not a change to
  the truncation itself) in both charts that truncate:
  `projectImpactStoryGoalProgressChart.tsx` (`GoalProgressAxisTick`,
  y-axis) and
  `projectImpactStoryPairedDeltaGroupChart.tsx` (`PairedDeltaXAxisTick`,
  x-axis, replicating the existing label-rotation behavior since a custom
  `tick` element bypasses Recharts' built-in `angle`/`textAnchor`
  handling). Chosen over simply raising the character cap because a
  tooltip surfaces the *full* text losslessly regardless of length,
  where any fixed cap would just move the same problem to a longer
  string. `ia_webapp` typecheck/lint/tests all pass.

---

## 2. Display-label generation — a new, narrowly-scoped LLM call

**[DONE]** Implemented end-to-end across all three services:

- `ia_python_service`: new `generate_goal_display_label`
  (`app/project_impact_story/display_label.py`) + route
  `POST /internal/project-impact-story/goal-display-label`. Single string
  in (`text`, `language`), short label out — no grounding-retry loop
  (nothing to fact-check for a pure rewrite), just a deterministic
  40-char length cap with a guaranteed-safe truncated-input fallback if
  the model returns something empty or too long.
- `ia_backend`: new content-addressed `goal_display_labels` collection
  (`goalDisplayLabelModel.ts`/`...Persistence.ts`/`...Repository.ts`,
  keyed on `sha1(language::goalText)`) behind `GoalDisplayLabelService`
  — cache-first, dedupes by unique goal text across one story-generation
  run, sequential (not parallel) generation on a cold cache, and never
  blocks story generation: any failure falls back to the raw goal text.
- **Resolved the backfill/rollout question this section originally
  flagged as unaddressed, by construction rather than by adding a
  script**: because the cache is keyed on the goal text's own content
  (not a foreign key to a "goal" entity that doesn't exist — see §0's
  finding that goals are just parsed lines of free text with no
  persisted record), there is nothing to backfill. The first time any
  given goal text is ever seen — on any project, past or newly
  created — it generates and caches once, forever. No migration script,
  no blank-until-backfilled state.
- **Resolved the cost/latency question this section also flagged**: one
  call per distinct goal text, generated lazily on first read and never
  again — not batched, not regenerated per V2 run or dashboard load.
- Wired into both real leak sites identified in §0: the goal-progress
  chart (added a real `displayLabel` field alongside the existing
  `label`, so §1's tooltip still shows the full original text — only the
  visible bar text got short) and the chart-plan LLM's own input (which
  authors its own KPI tile labels from what it's given, so feeding it
  the short label as a starting point fixes that path too, rather than
  trying to post-edit whatever it writes).
- `ia_backend`/`ia_python_service`/`ia_webapp` all typecheck/lint/test
  clean.

**This is new work, not a revival of anything.** The closest prior art —
V2's old activity-level LLM narrative/summary layer (formerly Stage 13,
`recommendation.py`'s `renderedSummary`/`recommendationText`) — was
deliberately removed on 2026-08-17, with the architectural decision
recorded directly in the pipeline doc: *"the assessment object is the
source of truth... this module does not author user-facing summary prose
anymore."* That removal was about **prose narrative asserting things
about structured data**, not about **short display-label rewriting** —
this proposal is scoped narrowly enough not to repeat that mistake:

- **Input**: a single string — `goalText`, a survey question's raw label,
  or (once the qualitative-evidence work ships) a coded-theme label.
  **Output**: a short (~3–5 word) display label. Nothing else.
- **Contractually forbidden from seeing or referencing any value, target,
  or status alongside the text it's shortening.** This is what keeps it
  cosmetic rather than a re-run of the removed narrative layer — it
  rewrites a label, it doesn't summarize or characterize what the label
  means.
- **Generate once, cache, don't regenerate per V2 run or per dashboard
  load.** A goal's display label shouldn't change wording between
  refreshes just because the LLM sampled differently. The natural trigger
  point is goal/question definition or edit time, not V2 execution time,
  since the same `goalText` is reused across every subsequent run on that
  activity.
- **§0's `[VERIFY]` resolved — the existing `labelDe` mechanism is real
  but doesn't cover this case.** `context_distribution`'s
  `labelDe`/`dimensionLabelDe` are a deterministic `humanizeColumnName`
  transform on a column name, not an LLM call — confirmed, not extended
  here, because it solves a different problem (tidying a short raw column
  name) than this one (compressing a full sentence into a display label).
  This LLM call is genuinely new work, not a parallel system replacing an
  existing one.
- **Sequence ahead of the new qualitative evidence shape landing on
  charts.** Confirmed `paired_categorical_shift` and
  `single_distribution`-over-`subjective_code` entries will render with
  raw coding-theme names and raw survey question text the moment their
  chart component ships — the identical failure mode, just with new
  evidence types. Landing this first means that work can consume it from
  day one instead of shipping the same bug twice.
- **[RESOLVED, see [DONE] block above] Rollout/backfill for existing
  goals.** Turned out not to need a script at all — a content-addressed
  cache has nothing to backfill; the first read of any goal text (old or
  new) is the only "backfill" that ever needs to happen.
- **[RESOLVED, see [DONE] block above] Cost/latency.** One call per
  distinct goal text, ever, generated lazily on first read.

---

## 3. Fix the source caption — deterministic, not LLM

**[DONE]** §0's `[VERIFY]` resolved: source captions for `goal_assessment`/
`calculation`/`paired_delta`/`paired_story_delta`/`context_distribution`
were all built the same way — a raw `` `Quelle: ${tableName}` `` (or
`beforeTableName → afterTableName`) string concatenation, confirmed at
`projectImpactStoryImpactCatalog.ts:343,399,426` and
`activityAnalysisV2Service.ts:781`. **§0 originally implied
`context_distribution` already had this solved (it didn't) — fixed
across all five entry kinds, not the four originally listed.**

**This section's original framing didn't hold up** — checked directly:
`UploadMetadata` has no description field, `tableName` is frequently
*derived from* `originalFileName` (`evidence_parser.py:118`), so there
was no existing richer field to look up. Decided with the user: option 2
(pair the table name with the activity name), not the bigger
new-upload-description-field option.

**Implemented**: `buildSingleTableSourceCaptionDe`/
`buildPairedSourceCaptionDe` (`projectImpactStoryImpactCatalog.ts`) —
`` `Quelle: ${activityName} — ${tableName}` `` for a single-table entry,
`` `Quelle: ${activityName} — ${beforeTableName} → ${afterTableName}` ``
for a paired entry when both sides share one activity (the common case
post-outcome-evidence-merge), naming each side separately only when they
genuinely differ. `context_distribution`'s caption
(`activityAnalysisV2Service.ts`) already had `activity.name` in scope —
one-line fix, no new dependency needed. The other three shapes needed a
new `activityNameById: Map<string, string>` threaded through
`buildProjectImpactStoryImpactCatalog`'s deps, built once in
`projectImpactStoryService.ts` from data it already loads. Falls back to
the bare table name if an activity can't be resolved — never throws over
cosmetic metadata. `ia_backend` typecheck/lint/test clean (one existing
test's expected string updated to match the new format, not a
regression); new dedicated tests cover both the single-activity and
shared-activity-named-once cases.

---

## 4. Scale-direction (polarity) metadata — a real, confirmed gap

**[DONE]** Implemented as a new preparation-stage question, not a goal/
outcome-definition property — see below for why that [VERIFY] resolved
the way it did, and a real trigger-condition problem found and fixed
along the way:

- **The plan's own proposed trigger (`validated_scale` columns) doesn't
  exist in production.** `_classify_epistemic_role` in
  `interpretation_pipeline.py` always classifies a numeric column as
  `metric_count` — the `validated_scale_confirmation` question that used
  to promote a column to `epistemicRole: "validated_scale"` was removed
  in the outcome-evidence redesign, and nothing replaced it. Keying the
  new question on `validated_scale` as originally written would have
  shipped a question that never fires. Resolved with the user: trigger
  on every `metric_count` column instead (simpler than a narrow-range
  heuristic, at the cost of asking on plain counts too, e.g. "number of
  workshops held" — accepted as the tradeoff).
- **The `[VERIFY]` (preparation question vs. goal/outcome-definition
  property) resolved itself once §2's own investigation found there's no
  persisted goal/outcome-definition entity to attach a property to** — a
  "goal" is just a parsed line of `activity.output` free text (see §2's
  `[DONE]` block above), re-derived every run with a non-stable
  positional id. A preparation-stage question, resolving onto the real,
  persisted `PreparedDatasetColumn`, was the only viable home.
- **A real architectural gate found and fixed during implementation, not
  anticipated by the plan**: this codebase's `isPreparationQuestion`
  filter (`datasetPreparationService.ts`) requires `isBlocking: true`
  before an answer is even resolved into `PreparedDatasetColumn` at
  all — conflating "counts as an unresolved readiness requirement" with
  "gets picked up by the resolution pipeline." Since `scale_direction`
  is deliberately non-blocking (asking on every `metric_count` column
  would otherwise stall interpretation readiness for nearly every
  dataset), a second filter (`isResolvableIntoPreparedDataset`) was added
  — used only for resolving answers, never for the readiness/blocking
  computation — with an explicit regression test proving an *unanswered*
  `scale_direction` question still reaches `ready_for_analysis`.
- Implemented: `PreparedDatasetColumn.scaleDirection` field
  (`"higher_is_better" | "lower_is_better" | null`), the
  `scale_direction` question (Python proposal + `ia_backend` bilingual
  copy/resolution, following the `epistemic_role_clarification`
  pattern), and the webapp's independently-mirrored type — no webapp UI
  work needed, the generic `InterpretationQuestionCard` renders any
  fixed-choice question with no special case required.
- **Consumers**:
  1. **[DONE]** Any chart that would otherwise plot multiple scale items on
     one shared axis — decided with the user: **exclude**, not flip/
     normalize (a false exclude costs nothing; a transformed/flipped
     displayed value risks a reader mistaking it for the real
     measurement). Implemented end-to-end: `ImpactCatalogEntry` gained a
     `scaleDirection` field, resolved per pair in
     `projectImpactStoryImpactCatalog.ts`
     (`resolvePairedDeltaScaleDirection` — conservative by design, either
     column declaring `lower_is_better` is enough, even if the other
     disagrees or was never answered) via two new dependencies
     (`interpretationResultRepository`/`datasetPreparationRepository`)
     threaded through `buildPairedDeltaEntry`. On the frontend
     (`projectImpactStoryPage.tsx`), a reverse-scored pair is excluded
     from `ProjectImpactStoryPairedDeltaGroupChart`'s shared-axis group
     and instead gets its own card — the same chart component, called
     with a one-entry array, so it gets an axis nobody else shares.
     Never silently dropped. `ia_backend`/`ia_webapp` typecheck/lint/test
     clean; new backend tests cover both the "both agree" and
     "either declares it, other silent" resolution paths.
  2. **[DONE]** Chart coloring/framing — decided with the user: a small
     2-state (`good`/`risk`, no `warn`) status dot next to each pair's
     axis label, not a recolored bar. This codebase has an explicit
     "collision rule" (`projectImpactStoryChartColors.ts`): a color
     channel that already carries one meaning shouldn't also carry
     status. The paired-delta chart's grey/blue bar colors already mean
     "before vs. after" (a series distinction) — recoloring the bars by
     status would have destroyed that legend. A separate dot,
     reusing `goalProgressStatusColor`, avoids the collision entirely.
     No `warn` state: a raw before/after delta has no declared target,
     so there's no "close to target" equivalent to show — only whether
     the real values moved in the declared favorable direction, moved
     against it, or (scaleDirection unknown, or no change at all) show
     nothing, never an invented middle state. Implemented in
     `projectImpactStoryPairedDeltaGroupChart.tsx`
     (`computePairStatus`); legend only appears once at least one pair
     actually has a resolved status, so it isn't visual noise on
     projects where nobody has answered `scale_direction` yet.
  3. **[VERIFIED, not applicable — no code change]** Checked
     `narrative.py`'s actual prompt text directly: it never uses "right
     direction" language today, and paired-delta/paired-categorical-shift
     changes are described strictly neutrally ("moved from," "shifted") —
     the narrative plan's own restriction against target/achievement
     language already prevents this. This consumer was explicitly framed
     as "if/when" in the original plan; today's narrative simply doesn't
     have the described gap yet. Nothing to coordinate until that
     changes.

---

## 5. Sequencing

**Every section is now [DONE].** Both of §0's `[VERIFY]`s resolved (see
§0); all three open product-decision forks (§4's overflow UI, §4's
reverse-scored handling, §3's caption approach, §4's status-coloring
approach) were decided directly with the user rather than guessed at.

1. ~~§1's interim mitigation (tooltip)~~ **[DONE]** and ~~§1's real
   curation step (cap + prioritization + overflow handling)~~ **[DONE]**
   — both shipped in `ia_webapp`, `projectImpactStoryGoalProgressChart.tsx`
   / `projectImpactStoryPairedDeltaGroupChart.tsx`.
2. ~~§3 (source-caption fix)~~ **[DONE]** — activity-name pairing,
   decided over the bigger new-field option.
3. ~~§2 (display-label LLM call) and §4 (scale-direction metadata)~~
   **[DONE]** — both shipped across all three services, both consumed:
   §2 by the goal-progress chart and the chart-plan LLM input; §4 by all
   three of its own listed consumers — shared-axis exclusion, status
   coloring, and narrative coordination (the last one resolved by
   verification: today's narrative prompt has no "right direction"
   language to coordinate with yet).

Nothing from this plan remains open except real browser/live-LLM
verification (see §6) and any future work this plan didn't originally
scope (e.g. the new qualitative-evidence chart types §2 was sequenced
ahead of).

---

## 6. Validation

- **[DONE, verified via typecheck/lint/test — not yet visually confirmed
  in a browser]** the §1 interim mitigation: a goal with a `goalText`
  longer than 24 characters shows its full text on hover, via the SVG
  `<title>` on the custom axis tick.
- **[DONE, same caveat]** a large project (15+ goals) renders a legible,
  capped (8 by default) goal-progress chart, with a "+N more" control to
  reveal the rest (not a silent drop), and `risk`/`warn` goals surface
  ahead of already-`achieved` (`good`) ones, worst-first within each
  tier — replacing the old highest-progress-first order.
- **[DONE, verified via unit test, not yet a live LLM call]** display
  labels (§2) are stable across repeated dashboard loads and V2 re-runs
  for the *same* goal/question — proven at the cache-key level
  (content-addressed on exact goal text) rather than by observing two
  real runs live, since no live LLM call has been made this session.
- **[DONE, by construction]** §2's backfill mechanism: an existing
  project with goals that predate this feature gets a real display label
  on its first read, no manual trigger, no blank state — verified in
  `goalDisplayLabelService.test.ts`.
- **[DONE]** an unanswered `scale_direction` question (§4) never blocks
  interpretation readiness, only `PreparedDatasetColumn.scaleDirection`
  itself stays `null` until answered — the concrete regression test for
  the `isBlocking`-gate bug found and fixed during implementation
  (`datasetPreparationService.test.ts`).
- **[DONE, verified via unit test — not yet visually confirmed in a
  browser]** the source caption (§3) reads as `{activityName} —
  {tableName}` on all five entry kinds, not a raw filename/table name —
  proven directly for `paired_delta`, `single_distribution`, and
  `context_distribution` (one dedicated test each); `paired_categorical_
  shift` and `paired_story_delta` share the exact same builder functions
  (`buildPairedSourceCaptionDe`), so covered by construction rather than
  a fifth duplicate test.
- **[DONE, verified via unit test — not yet visually confirmed in a
  browser]** a project containing at least one genuinely reverse-scored
  item (a "days without X" or "how often does Y still happen" style
  question, declared `lower_is_better`) alongside normally-scored items:
  the reverse-scored pair is excluded from the shared-axis group chart
  and rendered as its own single-pair card instead — proven at the
  catalog-building and page-composition level
  (`projectImpactStoryImpactCatalog.test.ts`), not by observing a real
  rendered dashboard.
- **[DONE, verified via typecheck/lint — no unit test for a UI-only
  color/legend computation, not yet visually confirmed in a browser]**
  §4 consumer 2: a pair moving in its declared favorable direction shows
  a green status dot next to its axis label; moving unfavorably shows
  coral; unknown direction or no change shows neither, and the legend
  entries for "positive"/"negative change" only appear once at least one
  pair actually has a resolved status.
- **[VERIFIED, not applicable]** §4 consumer 3 (narrative "right
  direction" coordination) — confirmed by reading `narrative.py`
  directly that no such language exists in the current prompt to
  coordinate with; nothing to test.

**What's never been confirmed this session, for any item above:** a real
browser render, or a real generated project-impact-story dashboard. Every
"[DONE]" here is backed by typecheck, lint, and unit tests only.
