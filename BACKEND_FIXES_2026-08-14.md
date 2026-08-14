# Backend Fixes — 2026-08-14

Summary of code-review-driven fixes and cleanup applied to `ia_backend` in this
session. Verified after every change with `tsc --noEmit` (clean) and the full
test suite (`node --import tsx --test "src/**/*.test.ts"`, 270/270 passing).

## Blockers

1. **Broken `hasOutcomeSection` detection** — the check used an exact-line-match
   regex that silently failed to detect an existing "Wirkung"/"Outcome" section
   in rendered narratives. Fixed to a substring match. (This code was later
   removed entirely as part of the `shadowComparison` cleanup below.)

2. **Unvalidated `excerpt_retrieval` limit** —
   `activityAnalysisV2QualitativeTools.ts`'s `executeExcerptRetrieval` sliced
   an array using an LLM-supplied `limit` with no bounds checking. Clamped to
   a finite, non-negative integer before use.

3. **Narrative-generation failure discarded completed tool-execution work** —
   in `activityAnalysisV2Service.ts`, `previewActivityAnalysis` used a single
   try/catch around both tool execution and narrative rendering. If narrative
   generation failed _after_ tool execution succeeded, the already-computed
   `execution`/`assessmentResult` were discarded and the persisted run showed
   an empty result instead of the real (but unrendered) findings. Restructured
   into nested try/catch so a narrative failure now persists a run with
   `phase: "phase_4_rendering"`, `status: "failed"`, and the real
   `toolCallTrace` / `calculations` / `qualitativeFindings` / `assessment`.

4. **Upstream error details leaking to clients on 5xx** —
   `errorHandler.ts` forwarded `AppError.details` to the client regardless of
   status code. Since `details` is a legitimate, widely-used convention for
   client-actionable 4xx data (verified across ~10+ call sites — e.g.
   `missingPrivacySafeUploads`, `allowedOptions`, `questionId`), the fix was
   scoped to the handler only: `details` is now stripped for `statusCode >=
500` and still forwarded for 4xx.

## High-value nits

1. **Linkage proposal-decision race condition** —
   `evidenceLinkageReconciliationService.ts`'s `reviewProposal` did a
   read-modify-write on `current.proposalDecisions`, which could lose a
   concurrent decision. Replaced with an atomic
   `upsertProposalDecision(activityId, proposalId, decision, decidedAt,
session)` on the repository: scoped `$set` via `arrayFilters` if the
   proposal decision already exists, otherwise a guarded `$push` (`$ne` filter
   to prevent duplicate inserts), with a single retry of the `$set` path if
   the push loses a same-proposal race.

2. **`EpistemicRole` type duplication** — `pythonProcessingClient.ts` hand-duplicated
   the 8-value `EpistemicRole` union at two call sites
   (`QualitativeCodingReviewRequestInput` and
   `ActivityAnalysisV2EvidenceColumnInput`). Both now import the single
   `EpistemicRole` type from `shared/contracts.ts`.

## Dead-code / DRY cleanup

1. **Removed legacy `/ai-knowledge` V1 endpoints** — confirmed zero consumers
   in `ia_webapp` before removing. Deleted the 3 route registrations, the
   corresponding controller handlers, and the service-layer legacy mapping/
   preview methods and their contract type.

2. **Removed `shadowComparison` / `cutoverReadiness`** — this V1-vs-V2
   migration scaffolding had zero consumers (confirmed via cross-repo grep).
   Split the source file so the still-live `diagnostics` builder (rendered in
   the webapp's analysis panel) survived in a new
   `activityAnalysisV2Diagnostics.ts`, and deleted the dead comparison/cutover
   code, its Mongo schema fields, persistence types, and contract types
   entirely.

3. **Consolidated epistemic-role merge logic** — this logic had drifted into
   three separate implementations: a private unexported helper already inside
   the "foundational" `activityAnalysisV2ToolRowResolution.ts`, a duplicate
   private method on the tool executor, and a hand-rolled `filter`/`findIndex`
   version in the aggregation/set tools. Exported the foundational module's
   version as the single canonical `mergeSourceColumnEpistemicRoles` (plus
   `collectEpistemicRoles`) and repointed both other call sites at it,
   deleting the duplicates. This logic backs the epistemic-role security gate
   (`activityAnalysisV2EpistemicRoleGate.ts`), so a second, subtly different
   merge implementation was a real risk of silent divergence, not just style
   debt.

   Deliberately left `collectColumnEpistemicRolesFromReference` on the tool
   executor unconsolidated — it uses an index-based lookup convention shared
   with 5+ sibling methods in that file, genuinely different from the
   foundational module's linear-scan approach. Forcing consistency there would
   trade a working convention for uniformity alone.

## Known non-blocking items, deliberately not fixed

- **Secondary race in `evidenceLinkageReconciliationService.ts`'s
  `reconcileForActivity`** — opens only when concern-tagging is configured and
  two reconciliations overlap across an LLM call. Currently dead code from the
  product's perspective (concern-tagging has no shipped UI). A proper fix
  needs optimistic concurrency (a version field + conditional write + retry)
  across the whole read-recompute-write pattern — a bigger, separate change,
  not scoped into this session.
