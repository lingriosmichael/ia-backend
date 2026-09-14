# Impact Story Narrative — Improvement Plan (v7)

Goal: make the Project Impact Story narrative read like the manually-written
"Miteinander im Kiez" example — genuinely qualitative, cross-activity,
goal-organized — instead of today's disjointed, numbers-heavy output.

## Why this version exists

v4 corrected v3's mechanism (the outcome-evidence recommendation/approval
flow was redesigned, and v3 was written against the deleted pre-redesign
version). v5 incorporated source-code review feedback that tightened the
compatibility check, the codebook-reuse design, and added the missing
rollout/backfill concern. v6 replaced §4's directive-only prompt notes
with an actual redline of the verbatim `narrative.py` prompt.

This version incorporates a second round of source-code review against
files v6 hadn't touched, fixing six things: an over-claim about what the
grounding checker already enforces (§4b), an over-broad diagnostics claim
that doesn't cover "never proposed" recommendations (§1b), an
under-specified codebook-provenance key that doesn't match the current
finding-keyed model (§2), an unverified normalization claim that turned
out to be false (§1b), a prompt-contract gap where §4e/§4f referenced
target values with no defined request field for them (§3), and two
`[VERIFY]`s that are now resolved rather than left open (§2a, §5) — one of
which changes this plan's priority framing materially: there is currently
**no unconfirmed path at all** for coded qualitative data to reach either
LLM call, which makes §2a's audit step the only existing lever for this
project's qualitative evidence, not just the cheapest one.

Line references below are trusted as given, not independently re-verified
against source.

---

## 0. What the real architecture means for this project's data

Unchanged from v4. One merged `outcome_evidence` activity per project (no
`baseline`/`impact_measurement` split anymore); pairing identity is
proposed by one joint LLM call and re-validated + scored from real data at
approval time, never declared upfront by a human tag. The Ja/Nein/Vielleicht
questions and the open-text wish-list question have no path into the
confirmed-outcome catalog today because the recommendation shape enum only
has two values (`paired_delta`, `single_distribution`) — not because of a
narrative gap or a missing declared-tag step.

---

## 1. New shape: `paired_categorical_shift`

### 1a. `ia_python_service` — teach the recommendation call a third shape

Unchanged from v4: add `"paired_categorical_shift"` to `recommendation.py`'s
response `shape` enum and extend the recommendation prompt so the model can
propose it for column pairs whose `epistemicRole` is in
`{"categorical", "subjective_code", "flag"}`.

### 1b. Compatibility check — split by role, not one rule

This is the main change from v4. v4 proposed one compatibility rule
("observed category sets substantially overlap") applied uniformly, with
`subjective_code` as an afterthought exception in §2. That's backwards, and
risky specifically for `subjective_code`: genuine change is expected to
*reduce* overlap between baseline and endline theme distributions — a
project succeeding at its goal should shift the coded-theme mix, not
preserve it. Using overlap as the compatibility proxy would penalize the
exact signal this shape exists to detect.

Split the check by role from the start, in
`OutcomeEvidenceRecommendationApprovalService` /
`outcomeEvidenceApprovalSafetyCheck.ts`:

- **`categorical` / `flag` (fixed-domain questions)** — normalized
  answer-set comparison: both columns' real, observed answer values,
  normalized to the same convention the codebase already uses elsewhere
  for outcome-evidence safety checks — trim, lowercase, collapse
  whitespace, nothing more (`outcomeEvidenceApprovalSafetyCheck.ts`; no
  synonym mapping exists today) — must resolve to the *same* domain (e.g.
  both are `{Ja, Nein, Vielleicht}`). This is a domain-identity check, not
  an overlap-in-practice check — a Ja/Nein/Vielleicht column pairs with
  another Ja/Nein/Vielleicht column regardless of how the actual answers
  shifted between waves. Reject if the two columns' answer domains don't
  match structurally. If answer-domain synonym handling (e.g. "Ja"/"ja"/"j"
  treated as one domain across differently-worded questionnaires) turns
  out to matter in practice, scope it as its own explicit task — don't
  fold it into this check silently.
- **`subjective_code`** — require explicit shared-codebook provenance, not
  observed overlap at all. Two `subjective_code` columns are compatible
  only if the endline column's coding review explicitly declares the
  baseline column's coding review as its reuse source (see §2 — this is
  the same mechanism, not a second one). **Important sequencing detail:**
  with the current architecture, this rule is enforceable at approval time
  immediately, but not yet at LLM-proposal time, because the current
  recommendation request sent to Python does not carry any codebook-
  provenance field. So the minimum safe implementation is: no provenance
  link → no confirmable pairing, regardless of how similar the two
  columns' code sets happen to look. If the product requirement is
  stronger — "do not even show a `subjective_code`
  `paired_categorical_shift` recommendation unless provenance exists" —
  then this plan must also extend the recommendation input surface
  (`outcomeEvidenceRecommendationService`'s candidate catalog, or a
  backend post-filter on the resolved recommendations) so the service can
  suppress such proposals before they reach the UI. Treat that as part of
  this shape's design, not as an emergent side effect of the current
  approval-time check.

Persist the check's result and reasoning the same way `matchDiagnostics`
is persisted for `paired_delta` today — this covers *why a proposed
pairing was accepted or rejected at approval*, the same scope
`matchDiagnostics` already has (it's written only when a link is actually
created/attempted, per `outcomeEvidenceRecommendationApprovalService.ts`).
It does **not** cover "why was this pairing never proposed in the first
place" — the recommendation call (`outcomeEvidenceRecommendationService.ts`)
returns suggestions without persisting any proposal-time diagnostics
today, so there's no audit trail for a pairing the LLM simply never
surfaced. If "never proposed" visibility is wanted, that's a separate,
new recommendation-audit design (the outcome-evidence analogue of
`chartOpportunityAudit`/`chartSelectionAudit`) — not something this
approval-time persistence gives you for free. Worth deciding whether it's
in scope for this plan or a later, explicitly-scoped addition.

### 1c. `pairingGroupKey` — decide what it means, don't carry it forward silently

Flagged directly from your review: if `pairingGroupKey` is currently just
`before.columnName` copied at approval time for `paired_delta`
(`outcomeEvidenceRecommendationApprovalService.ts` **[per your read]**),
it's not functioning as a group key anymore — it's a legacy field with a
new, undocumented meaning that happened to survive the redesign by not
being deleted. Before extending it to a third shape, make a deliberate
call:

- **Option A — drop it from the new shape.** If nothing downstream reads
  `pairingGroupKey` for a real purpose beyond display, don't carry it into
  `paired_categorical_shift` at all; add a one-line note in the contract
  explaining why it's absent here even though the sibling shape has it.
- **Option B — redefine it honestly.** If something does depend on it
  (even just a UI label), rename/redocument it as what it actually is
  today (e.g. `beforeColumnLabel`, or an explicit `pairingIdentifier`
  generated fresh at approval time) rather than reusing a name that implies
  a declared-group concept that no longer exists.

**Resolved:** `pairingGroupKey` is read downstream today by
`projectImpactStoryImpactCatalog.ts`, where `buildPairLabelDe` humanizes it
into the display label shown for confirmed paired outcome evidence; the
current approval path populates it from `before.columnName`, not from any
human-declared grouping metadata. So Option A is only safe if the new
shape carries some other honest display-label field (or the impact catalog
derives one directly from the referenced columns). Do not copy
`pairingGroupKey` into `paired_categorical_shift` unchanged and pretend it
still means a declared pair/group identity.

### 1d. Contract, executor, impact catalog — unchanged from v4

`ia_backend/src/shared/contracts.ts` gets `shape: "paired_categorical_shift"`
as a new discriminated variant; unlike `paired_delta`, it should not carry
legacy `pairingGroupKey` unchanged unless that field is first redefined
honestly. Give the new shape an explicit display-label field, or derive the
label later in the impact-catalog builder from the referenced columns.
`ActivityAnalysisV2ToolExecutor` gets `paired_category_shift` (join on
`matchKey`, return before/after category-count distributions, throw on
incomplete join rather than defaulting to zero); `projectImpactStoryImpactCatalog.ts`
gets `buildPairedCategoricalShiftEntry`, producing a new `ImpactCatalogItem`
kind, `PAIRED_CATEGORICAL_SHIFT`, carrying `outcomeId` and the before/after
category counts.

### 1e. Every place the narrative stack branches on shape — explicit checklist

This was the most concrete miss in v4: I described "narrative.py handling
a new entry kind" as one line, when it's actually several independent
places that each need the new shape added, and missing any one of them
produces a different silent failure mode:

| Location | What happens if `paired_categorical_shift` isn't added here |
|---|---|
| `projectImpactStoryImpactCatalog.ts` (§1d) | Link never becomes a catalog entry — nothing downstream sees it. |
| `ia_python_service/app/project_impact_story/models.py` (request/response Pydantic models — line ~26 per your read) | Backend can't even serialize the entry into the narrative request; hard failure or silent drop depending on how Pydantic validation is configured. |
| `narrative.py`'s prompt-building (`_describe_entry` equivalent) | Model never learns this entry exists or how to describe it — entry is invisible to the LLM even if it reached the request payload. |
| `narrative_grounding.py`'s candidate-number pool (line ~81 per your read) | Any category count the model correctly cites gets flagged as an ungrounded/fabricated number — the narrative permanently falls into "unverified" status for any project using this shape, even when the model did everything right. |
| `projectImpactStoryService.ts`'s deterministic fallback narrative builder (line ~143 per your read, `buildImpactCatalogFallbackNarrativeSummary`) | On a Python outage, the fallback narrative silently omits these entries instead of degrading gracefully — the one path specifically built to be robust becomes the one path that drops this shape. |
| Frontend chart dispatch (`ProjectImpactStoryChart` / the paired-delta group chart) | Entry has no visual representation even though it's grounded and in the narrative. |

Treat this table as the actual definition-of-done for "shape added," not
just the recommendation/approval/catalog trio.

### 1f. Frontend and preparation stage — unchanged from v4

New recommendation-card variant in `outcomeEvidenceRecommendationPanel.tsx`;
no preparation-stage work needed (no declared-tag question to add — see §0).

---

## 2. Qualitative text — extend the existing codebook-reuse mechanism, don't invent a parallel one

v4 proposed a new `reuseCodebookFrom: uploadMetadataId` parameter. Two
problems with that, per review: it duplicates a mechanism that already
exists (`sourceCodebook`, currently filename-driven — a sibling
`<source_basename>_codebook.csv` convention), and it's scoped one level
too coarse — coding review metadata is already per finding/column, not per
upload, and a single upload can contain multiple free-text findings.

### Revised approach: formalize `sourceCodebook`, scoped to column/finding

- Instead of a new parameter, extend the existing codebook-linkage
  mechanism (`qualitativeCodingReviewService.ts` /
  `qualitative_coding_review.py`) from an implicit filename convention to
  an explicit, reviewer-selected field. The current qualitative-review
  unit is a **finding keyed by `findingKey`** (`contracts.ts`), not a
  column or upload — so `{ uploadMetadataId, columnName }` is too weak a
  key; a column can have more than one finding. Use
  `sourceCodebookFrom: { uploadMetadataId, findingKey }`, persisted on the
  specific finding's coding review, not the upload or column as a whole.
  In the current implementation, one finding is emitted per free-text
  `tableName + columnName`, with `findingKey = "${table}::${column}"`, so
  `findingKey` is already the codebase's own concrete identifier for "the
  codebook for this free-text question." Carrying both `tableName` and
  `textColumnName` alongside it would just duplicate information the
  existing key already encodes.
- `qualitative_coding_review.py` codes the new column against the
  referenced column's already-approved codebook — assigns existing codes
  where they fit, flags (never silently invents) anything that doesn't
  fit, surfaced during the same approval step every proposed finding
  already goes through.
- `qualitativeCodingReviewDialog.tsx` needs an explicit "reuse codebook
  from [column]" picker when starting review on a new free-text column —
  replacing the current filename-inference with a reviewer's actual
  choice. Since both waves are the same activity now, this can list every
  approved coding review on that activity's other uploads as candidates.
- This same field is what §1b's `subjective_code` compatibility check
  reads: two `subjective_code` columns are pairing-compatible if one's
  `sourceCodebookFrom` points at the other. No separate overlap logic
  needed for this role — the explicit provenance link *is* the
  compatibility proof.

### What this gets you, concretely, for this project

Unchanged from v4: the wish-list question becomes a normal
`paired_categorical_shift` candidate once both waves are coded against the
same explicit codebook; the single-wave `Kommentar` fields stay
`single_distribution` candidates, no pairing needed.

---

## 2a. Does existing qualitative grouping already reach the LLM calls today?

**Resolved, and it changes the priority order below.** `run.contextCatalogEntries`
does **not** include `subjective_code` columns — V2's context-catalog
proposal only builds categorical candidates (`analyst.py`,
`activityAnalysisV2Service.ts`), matching `CURRENT_ANALYSIS_PIPELINE.md`'s
documented limitation that V2 never scans `subjective_code`/`free_text`
columns without a goal explicitly asking about them.

This means there is **no unconfirmed path at all** for coded qualitative
data — not to the narrative, and not to the chart-plan LLM either.
`single_distribution` confirmation (via the interpretation page's "Get
recommendations" flow) is the *only* way any coded free-text column
reaches either LLM call or renders as a chart today. That makes step 1 of
the rollout order (§6) not just the cheapest first check, but the only
existing lever at all for this project's `Kommentar`/wish-list data until
§1/§2 ship — worth being explicit about that when prioritizing this work
internally, since "audit what's already confirmable" isn't a stopgap here,
it's currently the entire capability.

---

## 3. Paragraph 1 — deterministic `narrativeOutputFacts`, independent of chart-plan

This is the other significant addition from v4, per review. v4 kept
paragraph 1 sourced from `headlineKpis` — the chart-plan LLM's own
4-tile selection, built for chart/tile display purposes. That's a real
coupling problem: whether an activity's output goal gets mentioned in the
narrative would depend on an unrelated LLM's chart-selection judgment that
run, not on whether the goal is real and grounded. Two different LLM calls
optimizing for two different things shouldn't share one data path.

**Add a separate, deterministic `narrativeOutputFacts` builder**,
parallel to (not sourced from) `toProjectImpactStoryNarrativeOutputFactRequests(headlineKpis)`:

- Pulls directly from the same grounded V2 catalog `projectImpactStoryCatalog.ts`
  already builds — every grounded `calculation`/`goal_assessment` entry
  with `goalType: "output"` — independent of whatever the chart-plan LLM
  selected as headline KPIs that run.
- This is what feeds paragraph 1's "organize by output goal" grouping
  (§4 below), so paragraph 1's content is stable and goal-anchored
  regardless of chart-plan output variance run to run.
- `headlineKpis` can stay as-is for its existing purpose (chart-plan
  tiles) — this isn't a replacement, it's decoupling two things that
  shouldn't have been sharing a source.

**Request shape — deliberately narrow.** Today's
`ProjectImpactStoryNarrativeOutputFactRequest`
(`projectImpactStoryService.ts`/`models.py`) carries only `label`, `value`,
`formatAs`, `narrativeReason`. Paragraph 1's grouping only needs *goal
identity*, not target values — so extend the shape by adding `goalId` and
`goalText` (for grouping and the "name the goal" phrasing in §4c), and
stop there. Do **not** add a `targetValue` field to this request. §4e/§4f
below aren't guarding against a target-value field that doesn't exist —
they're guarding against `goalText` itself, since a German goal statement
routinely embeds its own numeric target in the text (e.g. "Mindestens 65
Mentor:innen gewinnen"). That risk exists purely from `goalText` being
present in the prompt for the first time, independent of whether a
separate numeric target field is ever added.

---

## 4. Narrative prompt changes (`narrative.py`) — redlined

Five spots in the verbatim prompt (`_propose_narrative`,
`PROJECT_IMPACT_STORY_NARRATIVE_GENERATION.md` §4) need to change, not
just be summarized as directives. Each is shown as original → revised, so
the exact wording can be reviewed and adjusted before it goes in the code.
Unchanged prose is marked `[...]`.

### 4a. Entry-type definitions — add the fourth kind

The catalog-introduction sentence currently defines three entry kinds and
needs a fourth. This also fixes a real bug the v5 directives would have
left in place: without this, the model has no instruction for how
`PAIRED_CATEGORICAL_SHIFT` differs from `DISTRIBUTION`, and would likely
default to `DISTRIBUTION`'s "never describe as increased/decreased" rule —
exactly backwards for a shape whose entire point is a confirmed shift.

> **Original:** "...an outcome catalog with three kinds of entries:
> PAIRED_DELTA is a real measured before/after change (the same matched
> respondents, measured twice) — this is the only entry type you may
> describe as something that changed over time. DISTRIBUTION is a single
> snapshot at one point in time, not a measured change [...] UNMEASURED
> means no evidence is linked yet. Tell the story of all three: where
> things stood before, what the project did, and what the confirmed
> evidence shows now."

> **Revised:** "...an outcome catalog with four kinds of entries:
> PAIRED_DELTA is a real measured before/after change on a numeric scale
> (the same matched respondents, measured twice). PAIRED_CATEGORICAL_SHIFT
> is also a real measured before/after change on the same matched
> respondents, but expressed as a shift in category or theme counts
> instead of a scale average — PAIRED_DELTA and PAIRED_CATEGORICAL_SHIFT
> are the only two entry types you may describe as something that changed
> over time. DISTRIBUTION is a single snapshot at one point in time, not a
> measured change [...] UNMEASURED means no evidence is linked yet. Tell
> the story of all four: where things stood before, what the project did,
> and what the confirmed evidence shows now."

### 4b. Paragraph 2 — group by `outcomeId`, with an explicit tie-break rule

The original "choose at most 5, the strongest signal" rule and a new
"group by `outcomeId`" rule don't automatically reconcile — with more than
5 groups, nothing says whether to go deep on the strongest few or wide
across all of them. The revision picks wide-across-groups explicitly and
says so, plus adds `PAIRED_CATEGORICAL_SHIFT` phrasing guidance.

**On enforcement — worth being precise about what's actually checked.**
The existing checker (`narrative_grounding.py`) caps *distinct catalog
entries* per paragraph at 5, not distinct outcomeId groups. Since every
cited group needs at least one entry, that existing check does still cap
groups at ≤5 as an arithmetic side effect — citing from 6 groups requires
≥6 entries, which the current check already rejects, so no new code is
needed for the *ceiling*. But the existing check has no concept of
"groups" at all, so it cannot tell the difference between "5 entries
spread across 5 groups" (what the instruction wants) and "5 entries all
from 1 group" (a total violation of the breadth instruction that passes
the existing check identically). **The breadth requirement below — touch
every group rather than exhaust the budget on one — is a prompt
instruction only, not independently verified**, the same category as
several soft instructions already in this prompt (e.g. "if a source has
little to say, keep it brief"). If verified breadth enforcement is wanted
rather than requested, that needs new logic in `narrative_grounding.py`
that counts distinct `outcomeId` values across a paragraph's
`referencedEntryIds` and rejects low-diversity citation patterns when the
catalog has more groups available — scope that as its own follow-up if
it matters in practice, don't assume the redlined prompt below gets it for
free.

> **Original:** "[...] Choose at most 5 entries total in this paragraph —
> the strongest signal, the largest group, or the most central to what
> the project set out to do — and cite only the few real numbers that
> truly help the reader understand the scale or direction. This limit is
> enforced automatically: a paragraph citing more than 5 entries will be
> rejected and you will be asked to redo it, so choose deliberately rather
> than naming everything. For every other outcome-catalog entry, describe
> it only thematically, in your own words, with no number attached at
> all. Group by what entries share (the same population, the same theme)
> using connecting language ('similarly', 'alongside this', 'meanwhile')
> rather than restating each entry in isolation. If entries span more than
> one group of people (e.g. program participants and staff or
> volunteers), address each group in its own sentence or two rather than
> interleaving them. When you do cite a DISTRIBUTION entry, describe the
> overall pattern in words [...] Avoid technical phrases such as
> 'Indikatoren', 'matched pairs', 'Baseline-Befragte', 'Outcome-Messung',
> or 'PAIRED_DELTA'; translate them into natural user-facing language."

> **Revised:** "[...] The outcome catalog is organized by outcomeId — the
> specific Veränderungsziel (declared change goal) each entry supports.
> Address each outcomeId group in turn, in one or two sentences each,
> rather than describing one group in depth and the rest not at all — your
> goal is to touch every group that has real evidence, not to exhaust your
> citation budget on the single strongest one. Within a group, cite at
> most one representative entry plus its real count (e.g. nMatched), and
> describe any other entries in that same group only thematically, with no
> number attached. Across the whole paragraph, cite at most 5 entries
> total — this limit is enforced automatically: a paragraph citing more
> than 5 entries will be rejected and you will be asked to redo it, so
> choose deliberately rather than naming everything. If there are more
> than 5 groups with real evidence, prioritize the groups representing the
> largest number of matched or surveyed people for citation, and still
> name any remaining groups in one short sentence with no number attached,
> rather than omitting them entirely. If entries span more than one group
> of people within the same outcomeId (e.g. program participants and staff
> or volunteers), address each population in its own sentence or two
> rather than interleaving them. When you do cite a DISTRIBUTION entry,
> describe the overall pattern in words [...] When you cite a
> PAIRED_CATEGORICAL_SHIFT entry, describe the shift in plain terms using
> its real category counts (e.g. 'far more people now say they are
> interested in volunteering than before the project began') — never
> invent a percentage, never combine it with another entry's counts, and
> never use this kind of change-language for a DISTRIBUTION entry, which
> never represents a measured shift. Avoid technical phrases such as
> 'Indikatoren', 'matched pairs', 'Baseline-Befragte', 'Outcome-Messung',
> 'PAIRED_DELTA', or 'PAIRED_CATEGORICAL_SHIFT'; translate them into
> natural user-facing language."

Note the one substantive change from the earlier draft: the "enforced
automatically" sentence now correctly attaches to the *entries* cap (which
really is enforced, unchanged from today), not to a "groups" cap that
doesn't have its own check — the groups ceiling still holds, just as an
side effect of the entries cap, and the breadth instruction remains
unverified as described above.

### 4c. Paragraph 1 — group by output goal, without implying target achievement

This is the spot where §3's `narrativeOutputFacts` change most directly
touches prompt wording — naming a goal is now possible, and the prompt
needs to say clearly that naming a goal is not the same as claiming it was
met.

> **Original:** "[...] Then describe what the project actually did:
> reach, scale, completion, drawing only on OUTPUT_FACT entries. Purely
> descriptive ('X applications were received, Y people were trained, Z
> were formed') — never claim or imply this caused any outcome; that link
> belongs to paragraph 3, not here. [...]"

> **Revised:** "[...] Then describe what the project actually did,
> organized by the output goal each OUTPUT_FACT entry supports rather than
> as an unordered list of activity counts — group facts serving the same
> goal together, in the order the project itself would naturally consider
> them (e.g. recruitment before training before delivery, where that order
> is evident). Purely descriptive ('X applications were received, Y people
> were trained, Z were formed') — you may name the goal an activity relates
> to (e.g. 'to build a team of mentors, the project...') but never state
> or imply whether that goal was met, exceeded, or missed, and never cite
> a numeric target or a percentage-of-target — an OUTPUT_FACT's value is a
> real count of what happened, not a comparison to a plan. Never claim or
> imply this caused any outcome; that link belongs to paragraph 3, not
> here. [...]"

### 4d. Paragraph 3 — extend the "was there real change" test

The original condition only checks for `PAIRED_DELTA`'s absence. Left as
written, a project whose only measured change is a
`PAIRED_CATEGORICAL_SHIFT` would be told (incorrectly) that nothing in its
catalog measures change.

> **Original:** "[...] If every outcome-catalog entry is DISTRIBUTION (no
> PAIRED_DELTA entries at all), do not claim the evidence shows change,
> improvement, or movement — describe it as a first/current picture
> against that starting point instead, since nothing in the catalog
> actually measures a before/after difference. [...]"

> **Revised:** "[...] If every outcome-catalog entry is DISTRIBUTION (no
> PAIRED_DELTA or PAIRED_CATEGORICAL_SHIFT entries at all), do not claim
> the evidence shows change, improvement, or movement — describe it as a
> first/current picture against that starting point instead, since
> nothing in the catalog actually measures a before/after difference. If
> the catalog is a mix — some DISTRIBUTION entries alongside at least one
> PAIRED_DELTA or PAIRED_CATEGORICAL_SHIFT entry — you may describe overall
> movement, but only for the entries that actually measure it; do not
> extend a change claim to a DISTRIBUTION entry just because it appears
> alongside one that did change. [...]"

### 4e. The global target-language rule — replace a now-false claim

This is the fix for the contradiction flagged above. "Targets are not
part of either source" stops being true the moment §3 threads goal-linked
`narrativeOutputFacts` into paragraph 1 — even though target *values*
still won't be inserted into the prompt text itself, the model is now
working adjacent to goal context it wasn't before, and a flatly false
blanket claim is worse than an accurate, still-restrictive one.

> **Original:** "[...] Frame both halves as real progress and results,
> but never as a target being met, exceeded, or missed, and never with
> language such as 'Ziel erreicht', 'verfehlt', 'übertroffen', or a
> percentage-of-target — targets are not part of either source. [...]"

> **Revised:** "[...] Frame both halves as real progress and results, but
> never as a target being met, exceeded, or missed, and never with
> language such as 'Ziel erreicht', 'verfehlt', 'übertroffen', or a
> percentage-of-target. Even where an OUTPUT_FACT names the goal it
> relates to, describe only what happened — never how it compares to that
> goal's target. A goal's wording may itself contain a numeric target
> (e.g. inside `goalText`), but that target wording is present for
> grouping/context only and must never be restated numerically, referenced
> as evidence of achievement, or implied to have been reached. [...]"

### 4f. New grounding-checker guard — matches 4e, not just "causal language"

Ships in the same change as 4c/4e, since those are what make target
leakage possible for the first time. `narrative_grounding.py` needs a
check parallel to the existing `contains_causal_language` scan:
word-boundary-matched detection of a goal statement's own wording
immediately followed by achievement/target language ("Ziel," "erreicht,"
"geschafft," "übertroffen," "verfehlt," or a percentage adjacent to a goal
mention) — same defense-in-depth posture, checked across all supported
languages, not just the request's own.

---

## 5. Rollout/backfill for projects with existing confirmed links

Missing entirely from v4 — flagged in review, and it's a real adoption
blocker, not a nice-to-have. Per `OUTCOME_EVIDENCE_MERGE_PLAN.md`, "Get
recommendations" is hidden once *any* confirmed link exists for the
activity, and the only documented way back is "remove all confirmed
links." That means every already-active project gets zero benefit from
`paired_categorical_shift` unless someone manually deletes and redoes
their entire confirmed-evidence set — an unacceptable cost for adopting a
new shape.

**Resolved: this is cheaper than v6 assumed.** Server-side dedupe against
confirmed links already exists — `outcomeEvidenceRecommendationService.ts`
excludes columns already covered by a confirmed link from re-proposal
today. The missing piece is purely the frontend/controller gating
condition that hides "Get recommendations" once any link exists — not new
dedup logic.

**Recommend Option A, no longer hedged:**

- **Option A — incremental recommendations.** Relax the gating so "Get
  recommendations" can run again even with existing confirmed links. The
  dedup that would make this safe already exists server-side; this is a
  UI/controller-gating change, not a new backend mechanism.
- **Option B — explicit "check for new evidence types" action**, kept here
  only as a documented alternative: more explicit for the reviewer, but
  more UI work for no real safety benefit given Option A's dedup already
  covers the "don't re-propose what's confirmed" concern.

---

## 6. Rollout order

1. **Audit existing confirmable `single_distribution` recommendations over
   `subjective_code` columns (§2a)** — no code change. This is currently
   the *only* path any coded qualitative data has to either LLM call or a
   chart, per §2a's resolved finding, not just the cheapest first step.
2. **Decide the rollout/backfill approach (§5)** — resolved to Option A
   (relax the gating; dedup already exists) — this is a small, cheap
   change worth landing early since it unblocks every existing project
   before §1 even ships.
3. **§1 core**, including the role-split compatibility check (§1b), the
   resolved `pairingGroupKey` handling (§1c), and the full shape-branch
   checklist (§1e) — treat the checklist as the actual completion
   criterion.
4. **§3's `narrativeOutputFacts` builder**, including its deliberately
   narrow request shape (goal identity only, no target field) — can ship
   independently of §1, improves paragraph 1 stability regardless of
   outcome-shape progress.
5. **Narrative prompt grouping by `outcomeId`** (§4b) — independent of
   §1's completion; note the breadth instruction ships as a prompt-only
   ask unless the optional new grounding check described in §4b is also
   built.
6. **Codebook-reuse formalization** (§2), keyed on `findingKey` per the
   corrected shape — ships after §1 since it depends on §1b's
   compatibility-check hook.
7. **Paragraph 1 goal-grouping + target-leakage guard** (§4c/§4e/§4f) —
   ships together with §3, since §3 is what defines the `goalId`/`goalText`
   fields this prompt work depends on.

---

## 7. Validation

- Confirm end-to-end on this project once §1 ships, including the split
  compatibility check: verify a fixed-domain pairing (Ja/Nein/Vielleicht)
  is accepted via domain-match, and verify a `subjective_code` pairing
  with *no* declared codebook provenance is rejected even if its observed
  code sets happen to overlap heavily — this is the concrete regression
  test for the "overlap is the wrong proxy for `subjective_code`" fix.
- Confirm a rejected/orphaned `paired_categorical_shift` link behaves
  identically to a `paired_delta` one on re-upload (evidence no longer
  resolves → logged and skipped, not fatal).
- Run the §1e checklist as an actual test matrix: for each row, confirm
  the new shape is present and correctly handled, not just "doesn't
  crash" — especially the fallback-narrative and grounding-checker rows,
  since both fail *silently* rather than loudly.
- Confirm the rollout/backfill path (§5) on a project that already has
  confirmed `paired_delta`/`single_distribution` links — verify new
  `paired_categorical_shift` recommendations can be proposed and confirmed
  without disturbing the existing links.
- Once §4 ships, spot-check that a project with several outcome statements
  produces one sentence/short group per statement in paragraph 2, and one
  goal-anchored group per output goal in paragraph 1, independent of that
  run's chart-plan selection.
