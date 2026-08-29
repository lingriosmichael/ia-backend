# Outcome Evidence Merge Plan (Wirkungsaussagen → Merged-Activity, LLM-Recommendation Design)

Status: **implemented** (currently as uncommitted working-tree changes
across all three repos as of 2026-08-27/28 — verified by reading on-disk
source directly, not git history). This document replaces
`CURRENT_WIRKUNGSAUSSAGE_PIPELINE.md`, deleted from this directory as part
of writing this doc: that file described the old manual
"Wirkungsaussagen"/outcome-statements tab and its deterministic-candidate +
LLM-suggestion pairing flow, all of which this redesign removed. Both
`ia_backend/CLAUDE.md` and `ia_python_service/CLAUDE.md` already reference
this file by name and by section as the canonical doc for this feature —
this is that file, written from the actual on-disk implementation.

This document covers the project-level feature that proposes which pieces
of prepared evidence measure which of a project's declared outcome
statements, and lets a human confirm them. It does **not** cover
`ActivityAnalystV2` (see `CURRENT_ANALYSIS_PIPELINE.md`, this directory) or
Project Impact Story (see `CURRENT_ANALYTICS_PIPELINE.md`, this directory)
— this feature sits between those two: it consumes prepared evidence the
interpretation pipeline produces, and its confirmed output
(`OutcomeEvidenceLink` records) is what Project Impact Story reads to build
its narrative and chart plan. See "Relationship to the Rest of the
Pipeline" below for that boundary.

## Purpose

This document is written for a developer who needs to:

- understand what changed and why the old "Wirkungsaussagen" tab is gone
- understand the new merged-activity model and where `outcome_evidence`
  came from
- understand how a recommendation is generated, re-validated, and approved
- locate the key files in each service
- know what's genuinely new, what's a rename, and what's unchanged from
  the old design

## Executive Summary

The implemented flow is:

1. every project now has exactly one merged system activity,
   `systemType: "outcome_evidence"` (default name "Ausgangslage &
   Wirkungsdaten"), replacing the previous two-activity split
   (`baseline` + `impact_measurement`). Existing projects were migrated by
   a one-off script (`mergeBaselineAndImpactMeasurementActivities.ts`); the
   two old enum values no longer exist in `ActivitySystemType` at all — the
   script cannot be re-run against the current schema
2. a user still declares a project's intended long-term changes
   (`project.intendedChanges`), and the backend still keeps
   `project_outcome_statements` in sync with that array automatically —
   this part is entirely unchanged from the old design
3. during interpretation review of the `outcome_evidence` activity, a human
   answers a `cohort_tag` question per table — now via a dedicated
   drag-and-drop grouping UI (`InterpretationCohortGroupingBoard`) rather
   than free text. The old pairing-declaration questions
   (`validated_scale_confirmation`, `pairing_group_key`,
   `pairing_group_role`, `declared_scale_bounds`) are gone entirely — see
   `CURRENT_ANALYSIS_PIPELINE.md`'s Stage 5 for that removal in detail
4. on the interpretation page, once the activity is `ready`/`reviewed` and
   no links are confirmed yet, a "Get recommendations" action builds a flat
   candidate catalog of every eligible column on that one activity
   (`outcomeEvidenceCandidateCatalogBuilder.ts`) and sends it, plus the
   project's declared outcome statements, to `ia_python_service` in a
   single synchronous call — there is no pre-detection step and no
   human-declared pairing tag gating this
5. Python (`recommend_outcome_evidence_pairings`) proposes, in one LLM
   pass, both the column shape (`paired_delta` before/after, or
   `single_distribution` standalone) _and_ which outcome statement (if
   any) each recommendation supports — this joint proposal replaces the
   old two-stage design (a deterministic candidate matcher, then a
   separate outcome-only suggestion call)
6. `ia_backend` is the real trust boundary: every `columnId`/`outcomeId`
   Python returns is independently re-validated against the catalog it
   built and the project's real `ProjectOutcomeStatement` records —
   Python's own `recommendation_grounding.py` check is defense-in-depth
   only, never the final word
7. a human reviews recommendation cards in `OutcomeEvidenceRecommendationPanel`
   (grouped by outcome, then by shape/cohort) and confirms, dismisses, or
   manually adds a pairing the model missed via a candidate picker
8. confirming calls the approve endpoint →
   `OutcomeEvidenceRecommendationApprovalService`, the real safety-check
   layer: it re-resolves every column against current evidence, runs a
   cross-cohort safety check, and — as of the 2026-08-28 match-key fix —
   scores every shared column between the before/after tables by actual
   row overlap to pick the real join key, rejecting zero-match and
   ambiguous-key cases, before persisting anything
9. the result is a persisted `OutcomeEvidenceLink` (same collection as
   before, extended with `proposalId` and `matchDiagnostics`) — Project
   Impact Story reads this exactly as before; this feature's downstream
   contract to that feature is unchanged
10. deliberately, there is **no** server-side reconciliation cache for
    recommendations (unlike the old design's `outcome_evidence_pairing_results`
    cache) — every "Get recommendations" click is a fresh, real LLM call.
    Flagged as an open question below, not an oversight

Unlike `ActivityAnalystV2` and qualitative coding review generation, the
LLM-assisted recommendation call in this feature is **not** behind the
async job/poll pattern — see "Important Architectural Decisions" below.
This carries over unchanged from the old design.

## What's New vs. Renamed vs. Unchanged

Relative to the old candidate-matcher + suggestion design:

**Genuinely new:**

- joint pairing-shape + outcome-match recommendation in one LLM call
  (old design: deterministic candidate detection first, then a separate
  outcome-only suggestion call)
- approval-time real shared-key selection by scoring actual row overlap
  across candidate join columns
  (`OutcomeEvidenceRecommendationApprovalService.selectBestMatchKeyOrThrow`)
  — the old design just copied the "before" table's `identifierColumn`,
  which was the root cause of the paired-delta match-key bug fixed
  2026-08-28 (see `PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md`)
- `matchDiagnostics` persisted on `OutcomeEvidenceLink` — an audit trail
  for which join key was chosen and why (`matchedCount`, `baselineCount`,
  `comparisonCount`, `matchedRatio`, `candidateKeysConsidered`)
- a unique `{projectId, proposalId}` Mongo index on `outcome_evidence_links`,
  closing a concurrent-approval race the old read-then-write check
  couldn't close
- `mergeBaselineAndImpactMeasurementActivities.ts`, the one-off migration
  script
- a persistent, server-backed confirmed-links summary
  (`GET .../outcome-evidence-links`) that survives tab switches — the old
  panel's equivalent feedback was local-only React state
- `InterpretationCohortGroupingBoard`, a drag-and-drop UI for `cohort_tag`
  (replacing free-text answers per file)
- a bulk "remove all confirmed links for this activity" action/endpoint
- content-free `col_N` position tokens for LLM-facing column identity
  (`buildOutcomeEvidenceCatalogColumnId`), replacing compound raw-identifier
  strings — this fixed a real production bug where the model "tidied up"
  punctuation in copied-back column names and failed exact-match grounding
  on effectively every recommendation (see the Phase 6 post-mortem note in
  `ia_python_service/CLAUDE.md`)

**Renamed or relocated, same underlying logic:**

- `outcomeEvidencePairingCandidateMatcher.ts`'s cross-table safety checks →
  relocated into `outcomeEvidenceApprovalSafetyCheck.ts`, but moved from
  **proposal time** to **approval time** (there is no pre-declared pairing
  tag anymore to gate proposal on). Only the cross-cohort check survives;
  the old identifier-equality/duplicate-identifier checks were dropped from
  this helper because identifier choice is now a scored decision, not a
  static pre-check
- `buildPairedDeltaProposalId`/`buildSingleDistributionProposalId` →
  moved unchanged into `outcomeEvidenceApprovalSafetyCheck.ts`
- `outcomeEvidencePairingEvidenceLoader.ts` survives but is **narrowed**:
  its system-activity-scoped, project-wide loader
  (`loadProjectEvidenceTablesForOutcomePairing`) was deleted; the file now
  only serves an unrelated, permanently-disabled exploratory chart lane in
  Project Impact Story (`loadProjectEvidenceTablesForStoryPairing` — see
  `CURRENT_ANALYTICS_PIPELINE.md`'s Stage 3). Its row-scanning helper
  (`extractOutcomeEvidenceIdentifierMetadata`) was renamed/generalized to
  `extractOutcomeEvidenceTableRowMetadata` (now also returns per-column
  distinct-value counts) and is reused by the new single-activity loader in
  `outcomeEvidenceCandidateCatalogBuilder.ts`
- Python's suggestion module (`suggestion.py`/`suggestion_grounding.py`) →
  replaced 1:1 in shape by `recommendation.py`/`recommendation_grounding.py`,
  same `run_with_grounding_retries` pattern, same trust posture (empty
  result on failure, never a best-effort ungrounded draft)

**Unchanged:**

- `OutcomeEvidenceLink` remains the durable, human-approved output
  collection (`outcome_evidence_links`), and remains what Project Impact
  Story reads
- `ProjectOutcomeStatement`/`project_outcome_statements` and its
  CRUD/sync-from-`intendedChanges` logic (`projectOutcomeStatementService.ts`)
  — untouched by this redesign
- the `cohort_tag` interpretation question itself (still the authoritative,
  human-declared cohort signal) — only the pairing-tag questions around it
  were removed
- "a recommendation is never a decision" and "the backend service, not
  Python's grounding, is the trust boundary" — both principles carry over
  verbatim from the old suggestion design

## Service Boundaries

### `ia_webapp`

- `src/routes/projects/$projectId/interpretation.tsx` — hosts the review
  surface (see "New UI Location" below). There is **no** dedicated
  outcome-statements route anymore; confirmed via `routeTree.gen.ts` that
  nothing replaced `/projects/$projectId/outcome-statements` at the router
  level — it is simply gone
- `src/components/outcomeEvidenceRecommendationPanel.tsx` — the
  recommendation review panel
- `src/components/interpretationCohortGroupingBoard.tsx` — the `cohort_tag`
  drag-and-drop grouping UI
- `src/services/apiClient.ts` — new types
  (`OutcomeEvidenceRecommendation`, `OutcomeEvidenceConfirmedLink`,
  `OutcomeEvidenceCandidate`) and methods (`recommendOutcomeEvidencePairings`,
  `approveOutcomeEvidenceRecommendation`, `listOutcomeEvidenceConfirmedLinks`,
  `listOutcomeEvidenceCandidates`, `removeAllOutcomeEvidenceConfirmedLinks`)
- `src/hooks/useWorkspaceQueries.ts` — new hooks:
  `useOutcomeEvidenceRecommendationsQuery` (lazy, `enabled: false`, manual
  `refetch()` only — this is what makes every "Get recommendations" click a
  fresh call rather than a cached read), `useApproveOutcomeEvidenceRecommendationMutation`,
  `useOutcomeEvidenceConfirmedLinksQuery` (eager, real `GET`),
  `useOutcomeEvidenceCandidatesQuery` (lazy), `useRemoveAllOutcomeEvidenceConfirmedLinksMutation`

Deleted: `src/routes/projects/$projectId/outcome-statements.tsx`,
`outcomeEvidencePairingReviewPanel.tsx`, `outcomeStatementDeleteDialog.tsx`,
`outcomeStatementDialog.tsx`, `outcomeStatementImportDialog.tsx`,
`interpretationGroupQuestionCard.tsx` (the last one belonged to the removed
baseline/endline pairing grouping — see `CURRENT_ANALYSIS_PIPELINE.md`'s
Stage 5).

### `ia_backend`

`src/modules/outcome/`:

- `outcomeEvidenceCandidateCatalogBuilder.ts` (new) —
  `buildOutcomeEvidenceCandidateCatalog`, `loadOutcomeEvidenceActivityTables`,
  `buildOutcomeEvidenceCatalogColumnId`
- `outcomeEvidenceRecommendationService.ts` (new) — `recommendForProject`/
  `recommendForActivity`, `listConfirmedLinksForActivity`,
  `listCandidatesForActivity`; the real re-validation trust boundary
- `outcomeEvidenceRecommendationApprovalService.ts` (new) —
  `approveRecommendation`, `selectBestMatchKeyOrThrow`,
  `removeConfirmedLink`, `removeAllConfirmedLinksForActivity`
- `outcomeEvidenceApprovalSafetyCheck.ts` (new) —
  `assertPairedDeltaApprovalIsSafe`, proposal-id builders
- `outcomeEvidenceRecommendationController.ts` /
  `outcomeEvidenceRecommendationRoutes.ts` (new)
- `outcomeEvidenceLinkModel.ts`, `outcomeEvidenceLinkMongoRepository.ts`,
  `outcomeEvidenceLinkPersistence.ts`, `outcomeEvidenceLinkRepository.ts`
  (modified, not new) — added `proposalId` (unique-indexed) and
  `matchDiagnostics`; added `listByActivityId`/`deleteByActivityId`
- `outcomeEvidencePairingEvidenceLoader.ts` (survivor, narrowed — see above)
- `projectOutcomeStatementService.ts` (unchanged logic; only cleanup calls
  it makes were adjusted for the new activity model)

Deleted wholesale: `outcomeEvidencePairingCandidateMatcher.ts` (+ test),
`outcomeEvidencePairingController.ts`,
`outcomeEvidencePairingResultModel/Repository/MongoRepository/Persistence.ts`,
`outcomeEvidencePairingRoutes.ts`, `outcomeEvidencePairingService.ts`
(+ test), `outcomeEvidencePairingSuggestionService.ts` (+ test).

Elsewhere:

- `src/scripts/mergeBaselineAndImpactMeasurementActivities.ts` (new) — the
  one-off migration (see below)
- `src/modules/activity/systemActivities.ts` — the new `outcome_evidence`
  system activity definition
- `src/modules/processing/pythonProcessingClient.ts` — new
  `recommendOutcomeEvidencePairings` method + request/response schemas,
  calling `POST /internal/outcome-evidence-pairing/recommend`
- `src/shared/bootstrap/createApplicationContext.ts` — DI wiring for the
  new services/controller
- `src/shared/contracts.ts` / `src/schemas/httpSchemas.ts` — new API
  contract shapes for recommendations/candidates/confirmed links

### `ia_python_service`

`app/outcome_evidence_pairing/`:

- `recommendation.py` (new) — `recommend_outcome_evidence_pairings`, the
  one LLM call proposing shape + outcome jointly
- `recommendation_grounding.py` (new) — `validate_recommendation_output`,
  referential-integrity + cross-cohort checks (defense-in-depth only)
- `models.py` (modified) — `OutcomeEvidencePairingCandidateColumn`,
  `...RecommendationRequest`/`...RecommendationDraft`/
  `...RecommendationResponse`, replacing the old `...SuggestionCandidate`/
  `...SuggestionRequest`/`...SuggestionDraft`/`...SuggestionResponse` types
- `app/api/routes.py` — `POST /internal/outcome-evidence-pairing/recommend`,
  replacing the deleted `POST /internal/outcome-evidence-pairing/suggest-outcomes`

Deleted: `suggestion.py`, `suggestion_grounding.py`,
`tests/test_outcome_evidence_pairing_suggestion_grounding.py`.

`ia_python_service/CLAUDE.md` already documents the `/recommend` request/
response contract field-by-field under "Where job processing actually
happens" — treat that as the authoritative field-level reference; this
document stays the end-to-end architecture map.

## End-to-End Flow

See the Executive Summary above for the numbered flow. In file terms, a
"Get recommendations" click on the interpretation page runs:

`OutcomeEvidenceRecommendationPanel` (webapp) →
`useOutcomeEvidenceRecommendationsQuery().refetch()` →
`POST /projects/:projectId/activities/:activityId/outcome-evidence-recommendations`
→ `OutcomeEvidenceRecommendationController.recommend` →
`OutcomeEvidenceRecommendationService.recommendForActivity` →
`outcomeEvidenceCandidateCatalogBuilder.buildOutcomeEvidenceCandidateCatalog`
(loads every eligible column on the one `outcome_evidence` activity) →
`pythonProcessingClient.recommendOutcomeEvidencePairings` →
`POST /internal/outcome-evidence-pairing/recommend` →
`recommendation.py`'s `recommend_outcome_evidence_pairings` (one LLM call,
`run_with_grounding_retries`, referential + cross-cohort check via
`recommendation_grounding.py`) → response returned up the chain →
`OutcomeEvidenceRecommendationService` independently re-validates every
`columnId`/`outcomeId` against its own catalog and the project's real
`ProjectOutcomeStatement` records before anything is shown to the human.

Confirming a card runs:

`OutcomeEvidenceRecommendationPanel` → `useApproveOutcomeEvidenceRecommendationMutation`
→ `POST .../outcome-evidence-recommendations/approve` →
`OutcomeEvidenceRecommendationController.approve` →
`OutcomeEvidenceRecommendationApprovalService.approveRecommendation` →
`outcomeEvidenceApprovalSafetyCheck.assertPairedDeltaApprovalIsSafe`
(cross-cohort check) → `selectBestMatchKeyOrThrow` (real row-overlap scoring
across candidate join columns, rejecting zero-match/ambiguous cases) →
persists `OutcomeEvidenceLink` with `proposalId` + `matchDiagnostics`.

## New Merged System Activity: `outcome_evidence`

`ActivitySystemType` was narrowed from `["baseline", "impact_measurement"]`
to `["outcome_evidence"]` — the two old values do not exist anywhere in the
current schema. `mergeBaselineAndImpactMeasurementActivities.ts` performed
the one-time migration:

- for every project with exactly one `baseline` and one
  `impact_measurement` activity, it renames+retypes the `baseline` activity
  in place (`name: "Ausgangslage & Wirkungsdaten"`, `systemType:
"outcome_evidence"`), reusing `baseline`'s `_id` to minimize reference
  rewrites
- rewrites every `activityId`-keyed reference from the old
  `impact_measurement` activity onto that same id, across all
  activity-scoped collections plus the three `outcome_evidence_links` shape
  variants (`activityId`/`activityIdBefore`/`activityIdAfter`)
- deletes the now-empty `impact_measurement` activity document
- clears two reconciliation caches outright rather than rewriting them:
  `outcome_evidence_pairing_results` (deleted collection anyway — see Data
  Stores below) and `activity_evidence_linkage_results`. The latter is
  `unique: true` on `activityId`, so a plain field-rewrite of the old
  activity's documents onto the merged id would collide two documents onto
  one unique-indexed key — the script's own comments call this out as "a
  real bug in the first version of this script, not a hypothetical"
- reports (without touching) any project with only one of the two old
  activities, as a migration anomaly worth a human look

Explicitly **not** automated by the migration: converting a pre-existing
`single_distribution` link into a real `paired_delta` link where it should
have been one. The old `mergeIntoPairedDelta` action was retired outright
in this redesign rather than carried forward — that conversion, if wanted,
has to be redone by a human through the new recommend/approve flow.

## New UI Location

Review happens entirely inside
`routes/projects/$projectId/interpretation.tsx`'s `ActivityKnowledgeCard`:

- a "Get recommendations" action in the card's header, shown only when
  `activity.systemType === "outcome_evidence"`, status is `ready`/`reviewed`,
  and zero confirmed links exist yet — hidden outright (not disabled) once
  any link exists; the confirmed-links panel's "remove all" action is the
  only way to bring the button back
- `OutcomeEvidenceRecommendationPanel` rendered below the card body, same
  gating, receiving `recommendations`/`dismissedKeys`/`onDismiss` as props
  from the card rather than self-fetching, since the button and panel share
  state
- inside the panel: a persistent confirmed-links table (real `GET`,
  survives refresh), recommendation cards grouped by outcome then by
  shape/cohort, and a collapsible "manually add a pairing" form using the
  same candidate catalog and approval endpoint
- separately, `InterpretationCohortGroupingBoard` renders inline in the
  same route wherever pending `cohort_tag` questions exist, replacing
  individual per-file text-answer cards for that one question code

## Data Stores and Collections

### Canonical record for confirmed outcome evidence

- `outcome_evidence_links` (unchanged collection name). New fields:
  `proposalId` (required; backed by a new unique `{projectId, proposalId}`
  index — a real duplicate-prevention guarantee, not just an app-level
  check) and `matchDiagnostics` (`{matchedCount, baselineCount,
comparisonCount, matchedRatio, candidateKeysConsidered}`,
  `Schema.Types.Mixed`, nullable).

### Deleted collection

- `outcome_evidence_pairing_results` — the old design's reconciliation
  cache. Its model/repository/persistence are fully deleted; the migration
  script actively `deleteMany`s any leftover documents per project, treated
  as a disposable cache never rewritten. There is deliberately no
  replacement cache in the new design (see "Important Architectural
  Decisions" below).

### Other schema changes

- `activities.systemType` enum narrowed to `["outcome_evidence"]` (old
  `baseline`/`impact_measurement` values removed)
- `PreparedDatasetColumn` dropped `scaleMin`/`scaleMax`/`pairingGroupKey`/
  `pairingGroupRole` entirely — see `CURRENT_ANALYSIS_PIPELINE.md`'s Stage 5
- `InterpretationQuestion.preparationGroupId`/`preparationGroupColumns`
  kept on the contract but now always `null` (their only two question
  codes were removed) — deliberately not deleted from the type to avoid
  touching every mapper for no behavior change
- `activity_evidence_linkage_results` (`unique: true` on `activityId`) —
  cleared, not migrated, by the merge script (see above)

## Important Architectural Decisions

### 1. Pairing identity is no longer declared — it's proposed and re-validated

The old design required a human to explicitly tag which columns paired via
`pairing_group_key`/`pairing_group_role` before any pairing candidate could
even be detected. That declaration step is gone: the recommendation call
now proposes pairing shape directly from the flat candidate catalog, and
the approval step's real row-overlap scoring is what actually confirms two
columns share a join key — nothing is inferred from column names at any
point in this flow, only from the LLM's proposal (never trusted alone) and
real data overlap (trusted, computed deterministically).

### 2. A recommendation is never a decision

Carried over unchanged from the old "a suggestion is never a decision"
principle. An LLM-proposed `columnId`/`outcomeId` pair is never persisted
as-is; `OutcomeEvidenceRecommendationService` re-validates every id against
its own catalog and the project's real outcome statements, and
`OutcomeEvidenceRecommendationApprovalService` re-derives the actual join
key from real data before anything reaches the database.

### 3. The backend service, not Python's grounding, is the trust boundary

`recommendation_grounding.py` exists and checks referential integrity, but
it is defense-in-depth. The actual trust boundary is
`ia_backend`'s independent re-validation at proposal time and its safety
check + real row-overlap scoring at approval time.

### 4. This is a project-level feature scoped to one merged system activity

Unlike the old design (scoped to two system activities, `baseline` and
`impact_measurement`), the new design is scoped to the single
`outcome_evidence` activity per project. This is a structural
simplification, not a scope reduction — the merge means one activity now
holds everything the two old ones held.

### 5. The recommendation call runs synchronously, breaking from this codebase's established async-job default

Carried over unchanged from the old design. Every "Get recommendations"
click is a real-time LLM call on the request path, not behind the
job/poll pattern `ActivityAnalystV2` and qualitative coding review use. See
`CURRENT_ANALYSIS_PIPELINE.md`'s "Important Architectural Decisions" #8 for
why that pattern exists elsewhere and consider whether it should be
extended here if this call's latency/cost profile grows.

### 6. No server-side recommendation cache, by design

The old design cached its deterministic-candidate + suggestion
reconciliation in `outcome_evidence_pairing_results` so re-opening the tab
didn't always re-run the LLM. The new design has no equivalent cache —
every click is a fresh call. This trades a small latency/cost cost for
eliminating an entire class of cache-invalidation bugs the old design had
to manage (the paired-delta match-key bug this doc's sibling
`PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md` fixed was partly a consequence of
that cache's existence). Flagged as an open question below — revisit if
call volume/cost becomes a real concern.

## Current API Surface

### Outcome statements (unchanged)

- `GET/POST/PATCH/DELETE /projects/:projectId/outcome-statements[...]` —
  `ProjectOutcomeStatement` CRUD. Still exists, still has the same
  unreachable-from-any-UI manual-CRUD status the old design's doc
  described; only the automatic sync from `project.intendedChanges` is
  actually exercised in the product today.

### Outcome evidence recommendations (new — `OutcomeEvidenceRecommendationController`)

- `POST /projects/:projectId/activities/:activityId/outcome-evidence-recommendations`
  → `.recommend` (rate-limited; a real LLM call every time, see Decision 6
  above)
- `POST /projects/:projectId/activities/:activityId/outcome-evidence-recommendations/approve`
  → `.approve`
- `GET /projects/:projectId/activities/:activityId/outcome-evidence-links`
  → `.listConfirmedLinks`
- `GET /projects/:projectId/activities/:activityId/outcome-evidence-candidates`
  → `.listCandidates`
- `DELETE /projects/:projectId/outcome-evidence-links/:linkId` →
  `.removeConfirmedLink` — same route shape as the old design had, still
  project-scoped, still **unwired from any UI action** (see "Canonical vs.
  Legacy" below)
- `DELETE /projects/:projectId/activities/:activityId/outcome-evidence-links`
  → `.removeAllConfirmedLinks`

### Deleted (old design's API, fully removed)

- `POST /projects/:projectId/outcome-evidence-pairing/propose`
- `POST /projects/:projectId/outcome-evidence-pairing/refresh`
- `POST /projects/:projectId/outcome-evidence-pairing/decisions`
- Backend → Python: `POST /internal/outcome-evidence-pairing/suggest-outcomes`

### Internal (backend → `ia_python_service`)

- `POST /internal/outcome-evidence-pairing/recommend` — request:
  `{projectId, language, outcomeStatements: [{outcomeId, term, statement}],
candidates: [{columnId, label, epistemicRole, inferredType,
distinctValueCount, cohortTag}]}`; response: `{recommendations:
[{shape: "paired_delta"|"single_distribution", beforeColumnId,
afterColumnId, columnId, outcomeId: string|null, rationale}],
groundingStatus, llmUsage}`. Full field-level detail lives in
  `ia_python_service/CLAUDE.md` — kept there as the single field-level
  reference both services' owners check.

### Upstream prerequisite APIs

Same as the old design: this feature reads prepared, deterministic-analysis-
eligible evidence tables belonging to the project's `outcome_evidence`
activity — produced by the interpretation/dataset-preparation pipeline
documented in `CURRENT_ANALYSIS_PIPELINE.md`.

## Relationship to the Rest of the Pipeline

This feature sits between interpretation and Project Impact Story:

- **Upstream**: it reads prepared evidence tables the interpretation
  pipeline produces (`CURRENT_ANALYSIS_PIPELINE.md`, Stage 5) — same as
  before.
- **Downstream**: `OutcomeEvidenceLink` records are the only artifact this
  feature produces that anything downstream reads. Project Impact Story
  renders its narrative and impact catalog from confirmed links exactly as
  it did before this redesign — see `CURRENT_ANALYTICS_PIPELINE.md`'s
  Stage 1 ("the confirmed-outcome path"). That downstream contract did not
  change; only how a link gets confirmed changed.

## Canonical vs. Legacy

### Wired and live

- the entire recommend → review → approve flow described above
- `ProjectOutcomeStatement` auto-sync from `project.intendedChanges`
- the bulk "remove all confirmed links for this activity" action

### Backend routes/repository methods that exist but have no reachable frontend entry point today

- `DELETE /projects/:projectId/outcome-evidence-links/:linkId` (single-link
  remove) and its matching `useRemoveOutcomeEvidenceLinkMutation`/
  `apiClient.removeOutcomeEvidenceLink` on the frontend — both are
  explicitly commented in source as kept even though no current UI action
  calls them; only the bulk "remove all" action is wired into
  `OutcomeEvidenceRecommendationPanel`. Wire a button to it or remove it
  deliberately; don't assume from this document that a UI path already
  exists.
- most of the `ProjectOutcomeStatement` manual CRUD surface (unchanged from
  the old design's same finding)

## Guidance for Future Work

### Safe direction

- keep the re-validation trust boundary in `ia_backend` — never let
  Python's grounding check become the only check for a recommended
  id/outcome match
- if recommendation call volume/cost grows, consider a short-lived
  server-side cache keyed on a hash of the candidate catalog + outcome
  statements, invalidated whenever either changes — but weigh this against
  Decision 6's rationale for not having one before adding it back
- surface `matchDiagnostics` in the UI (currently persisted but invisible
  to users) so a human can see which join key was chosen and why, per
  `PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md`'s own "What Is Still Not Done"
  list
- add a manual join-key override path for genuinely ambiguous datasets
  where `selectBestMatchKeyOrThrow` currently just rejects
- either wire the single-link remove action into the UI or remove it and
  its backend route deliberately, rather than leaving it in this
  half-wired state indefinitely

### Unsafe direction

- reintroducing a name-pattern inference for pairing identity (this
  codebase's "ask, don't infer" rule — see
  `feedback_no_column_name_inference_for_semantics` in this repo's memory
  notes, if consulting saved conventions)
- trusting `recommendation_grounding.py`'s check as sufficient on its own,
  without `ia_backend`'s independent re-validation
- persisting an `OutcomeEvidenceLink` without running
  `selectBestMatchKeyOrThrow`'s real row-overlap scoring first

### Open considerations (not scoped, not committed)

- **No recommendation cache** (Decision 6) — a deliberate trade-off today;
  revisit if real-world call volume or LLM cost makes it a problem.
- **Backfill/audit for pre-fix links.** Links confirmed before the
  2026-08-28 match-key fix may carry a `matchKey` chosen by the old,
  possibly-wrong heuristic (a straight copy of the "before" table's
  `identifierColumn`) with no `matchDiagnostics` to show for it. No backfill
  or audit script exists yet — see `PAIRED_DELTA_MATCH_KEY_FIX_SUMMARY.md`.
- **Pre-merge `single_distribution` links that should be `paired_delta`.**
  The migration script only moved activity/document references; it did not
  attempt to reclassify any link's shape. Converting one requires a human
  to redo it through the new recommend/approve flow.
- Two small pieces of dead weight left behind by this redesign, worth
  cleaning up next time this area is touched rather than urgent on their
  own: `pythonProcessingClient.ts`'s `suggestOutcomeEvidencePairingOutcomes`
  method (plus its two schemas) has zero callers and points at a Python
  route (`/internal/outcome-evidence-pairing/suggest-outcomes`) that no
  longer exists — calling it would 404; and `httpSchemas.ts`'s
  `outcomeEvidencePairingMergeIntoPairedDeltaSchema` was added in this same
  redesign but also has zero callers, which is confusing given the
  migration script's own comments state that the `mergeIntoPairedDelta`
  action was retired outright rather than carried forward — resolve that
  contradiction (delete the schema, or the comment is wrong) before either
  one confuses someone else.

## Document Status

This file is the single source of truth for the outcome-evidence
recommendation feature. Two sibling documents in this same
`ia_backend/documentation/` directory cover adjacent features with the
same rigor and are not competing scope: `CURRENT_ANALYSIS_PIPELINE.md`
(the `ActivityAnalystV2` pipeline this feature reads prepared evidence
from) and `CURRENT_ANALYTICS_PIPELINE.md` (Project Impact Story, which
reads this feature's confirmed `OutcomeEvidenceLink` output). If another
Markdown file disagrees with this one on the outcome-evidence
recommendation flow, update or remove the other file rather than
reintroducing split documentation for this feature.
