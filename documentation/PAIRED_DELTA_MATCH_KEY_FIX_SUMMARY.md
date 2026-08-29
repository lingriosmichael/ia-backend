# Paired Delta Match Key Fix Summary

Date: 2026-08-28
Scope: `ia_backend`
Status: Core backend fix implemented and validated. The broader earlier plan is not 100% complete because it also included optional UI surfacing/manual override and a backfill/audit script for historical data.

## Problem

The paired before/after analytics pipeline could confirm a valid-looking `paired_delta` link and still later produce:

- `nMatched = 0`
- `beforeValue = 0`
- `afterValue = 0`
- an empty-looking chart
- narrative text claiming there were no matched respondents

This happened even though a human had already accepted the recommended pairings in the prior step.

The concrete failure mode was:

1. The approval flow persisted a `matchKey` copied from the prepared table's `identifierColumn`.
2. That `identifierColumn` came from a per-table heuristic, not from a real cross-table comparison.
3. In the failing project, the heuristic-selected key was `Antwort-ID`, while the real cross-wave join key was `Teilnehmenden-ID`.
4. The pairing therefore confirmed with the wrong persisted key.
5. Analytics later reused that persisted key and produced zero matched pairs.
6. The story generation path could also silently degrade a missing `paired_change` result into `0 / 0 / 0`, which made the UI look like "real zero data" instead of "broken measurement."

## Hypothesis

The investigation started with two competing hypotheses:

1. The analytics page was hardcoded to look for a specific identifier key and failed when the new project used a different one.
2. The analytics page was not hardcoded, but it was reusing the wrong persisted `matchKey` that had already been chosen earlier in the approval flow.

The code confirmed hypothesis 2.

The analytics page does not choose a key itself. It renders whatever paired-delta values are already present in `story.impactCatalog`. The real bug was earlier:

- approval selected and persisted the wrong join key
- analytics reused that persisted key
- the measurement path then produced zero matches

## Root Cause

### 1. Approval trusted per-table identifier heuristics too much

The old flow did this:

- resolve the `before` table
- resolve the `after` table
- read `beforeTable.identifierColumn`
- persist that as `matchKey`

That was unsafe because `identifierColumn` was only the first heuristic winner for each table. It was not proof that the same column was the best shared join key across both tables.

Why that failed:

- `Antwort-ID` can be a valid identifier column within one table
- but it is often a per-response id, not a shared participant id across waves
- `Teilnehmenden-ID` can be the real shared key even when it is not the heuristic's first choice

### 2. Analytics could silently materialize bad paired results as zeros

The paired-delta measurement builder read the `paired_change` result and previously defaulted missing values to zero. That hid failures behind plausible-looking output:

- `pairedCount ?? 0`
- `meanPre ?? 0`
- `meanPost ?? 0`

That was dangerous because the UI had no way to distinguish:

- true zero movement
- broken pairing
- missing tool output

### 3. Staleness ignored confirmed-link changes

The analytics staleness check only looked at:

- activity membership
- latest completed activity-analysis run ids

It did not treat confirmed `OutcomeEvidenceLink` changes as analytics-changing inputs, even though `impactCatalog` is built directly from those links.

That meant:

- approving/removing a pairing could leave analytics looking current when the overlay no longer reflected the live confirmed-link state

## Fix

## A. Replace heuristic key copying with real shared-key selection

Implemented in `OutcomeEvidenceRecommendationApprovalService`.

New behavior:

1. Load the actual current rows for the two target tables.
2. Find the set of shared column names across the two tables.
3. For each shared candidate key:
   - compute non-null counts on both sides
   - reject candidates with duplicates on either side
   - run the real paired-delta measurement using that key
   - reject candidates that produce `0` matches
4. Rank surviving candidates by:
   - highest matched count
   - then highest matched ratio
   - then stable name ordering for determinism
5. If two candidates tie exactly on the scoring dimensions, reject confirmation as ambiguous.
6. Persist the winning key as `matchKey`.

Why this decision was correct:

- It solves the actual bug class: wrong shared key selection.
- It remains generic across projects with different document structures.
- It does not hardcode `Teilnehmenden-ID`.
- It fails safe when the system cannot distinguish two plausible keys.

Why I did not "rename columns on merge":

- renaming changes labels, not meaning
- the real problem was picking the wrong cross-table join key
- a rename-only solution would not prove that two columns represent the same entity across waves

## B. Persist join diagnostics with the confirmed link

Added `matchDiagnostics` to paired links.

Stored values:

- `matchedCount`
- `baselineCount`
- `comparisonCount`
- `matchedRatio`
- `candidateKeysConsidered`

Why this decision was correct:

- It makes the join decision auditable later.
- It supports future UI surfacing without re-deriving the approval-time result.
- It makes debugging historical links much easier.

## C. Remove silent `0 / 0 / 0` fallback from analytics

Implemented in `computePairedDeltaMeasurement`.

New behavior:

- if `paired_change` does not return a usable result, the function throws
- the impact-catalog builder then skips the broken link and logs a warning

Why this decision was correct:

- fake zeros are more dangerous than an omitted chart entry
- a broken measurement should never masquerade as real evidence
- this keeps the system honest under data drift, re-uploads, or unexpected tool output

## D. Make analytics stale when confirmed links change

Implemented in `computeProjectImpactStoryStaleness` and the project analytics read path.

New behavior:

- analytics is stale when confirmed links exist but there is no matching overlay
- analytics is stale when a confirmed link was updated after the overlay
- analytics is stale when the overlay still contains more impact entries than the current confirmed-link set

Why this decision was correct:

- `impactCatalog` is derived from confirmed links
- therefore confirmed-link changes are first-class analytics inputs
- not treating them as stale was structurally wrong

## Files Touched

### 1. `ia_backend/src/modules/outcome/outcomeEvidenceRecommendationApprovalService.ts`

What changed:

- added real shared-key selection logic
- loaded current table rows from privacy-safe evidence
- scored candidate join keys by actual overlap
- rejected zero-match and ambiguous-key cases
- persisted `matchDiagnostics`

Why:

- this is the trust boundary for approval
- the wrong `matchKey` was being created here
- this is the only correct place to prevent bad pairings from ever becoming durable state

### 2. `ia_backend/src/modules/outcome/outcomeEvidenceApprovalSafetyCheck.ts`

What changed:

- removed the old identifier-name equality and duplicate-identifier checks from this helper
- kept the cross-cohort safety check

Why:

- identifier choice is no longer a table-level static check
- it is now a candidate-scoring decision that depends on real shared-row overlap
- keeping the old check would have preserved the original bad assumption

### 3. `ia_backend/src/modules/outcome/outcomeEvidenceLinkPersistence.ts`

What changed:

- added `OutcomeEvidenceLinkMatchDiagnostics`
- extended persisted link types to carry optional `matchDiagnostics`

Why:

- approval-time join decisions need durable audit metadata

### 4. `ia_backend/src/modules/outcome/outcomeEvidenceLinkModel.ts`

What changed:

- added `matchDiagnostics` to the Mongo schema

Why:

- persistence shape had to match the new audit payload

### 5. `ia_backend/src/modules/outcome/outcomeEvidenceLinkMongoRepository.ts`

What changed:

- mapped `matchDiagnostics` back out of Mongo documents

Why:

- without repository support, the new diagnostics would be write-only

### 6. `ia_backend/src/modules/projectImpactStory/projectImpactStoryImpactCatalog.ts`

What changed:

- removed zero-fallback behavior for missing `paired_change` output
- now throws when the measurement result is incomplete

Why:

- analytics must not convert broken measurements into fake valid zeros

### 7. `ia_backend/src/modules/projectImpactStory/projectImpactStoryStaleness.ts`

What changed:

- expanded staleness inputs to include confirmed links and the matching overlay state
- added confirmed-link-aware stale conditions

Why:

- the old stale model ignored a real source of analytics drift

### 8. `ia_backend/src/modules/projectImpactStory/projectImpactStoryService.ts`

What changed:

- analytics read path now loads confirmed links
- passes confirmed links and overlay into staleness computation

Why:

- the staleness function needed real current link state

### 9. `ia_backend/src/modules/outcome/outcomeEvidenceApprovalSafetyCheck.test.ts`

What changed:

- updated tests to reflect the narrower role of the safety helper

Why:

- the old tests encoded obsolete assumptions about identifier equality at this stage

### 10. `ia_backend/src/modules/outcome/outcomeEvidenceRecommendationApprovalService.test.ts`

What changed:

- rebuilt fixtures to include both `antwort_id` and `teilnehmer_id`
- added a regression test where heuristic `identifierColumn` is wrong but shared-key scoring still chooses `teilnehmer_id`
- added an ambiguous-key rejection test
- asserted that `matchDiagnostics` is persisted

Why:

- this file now carries the main correctness contract for the fix

### 11. `ia_backend/src/modules/projectImpactStory/projectImpactStoryImpactCatalog.test.ts`

What changed:

- added regression coverage proving missing `paired_change` output is skipped instead of rendered as zeros

Why:

- this directly covers the second observed failure mode

### 12. `ia_backend/src/modules/projectImpactStory/projectImpactStoryStaleness.test.ts`

What changed:

- new test file covering confirmed-link-driven staleness behavior

Why:

- the old behavior had no direct test coverage

## Decisions Defended

### Decision: Score all shared keys instead of preferring the prepared `identifierColumn`

Defense:

- the prepared `identifierColumn` is local to one table
- paired analytics is inherently cross-table
- therefore join-key choice must be validated cross-table

### Decision: Reject ambiguous winners instead of picking one arbitrarily

Defense:

- arbitrary selection would create durable but potentially wrong state
- ambiguity is a data-quality problem, not a place for hidden heuristics

### Decision: Persist diagnostics now even though the UI does not yet show them

Defense:

- approval-time evidence is the highest-value moment to capture
- delaying persistence would lose auditability
- UI can be added later without another data-model redesign

### Decision: Skip broken paired entries instead of showing zeros

Defense:

- missing evidence is safer than false evidence
- zero is a meaningful business value and must not be overloaded to mean "failed computation"

### Decision: Mark analytics stale on confirmed-link changes

Defense:

- link changes alter the meaning of `impactCatalog`
- any state derived from links must be invalidated when links change

### Decision: Keep the fix backend-first

Defense:

- the bug source was backend persistence and backend regeneration semantics
- fixing UI first would only mask symptoms
- backend hardening benefits every current and future frontend surface

## Validation

Targeted validation completed:

- targeted backend tests: `30/30` passing
- backend typecheck: passing

Command used for focused validation:

```bash
node --import tsx --test \
  src/modules/outcome/outcomeEvidenceApprovalSafetyCheck.test.ts \
  src/modules/outcome/outcomeEvidenceRecommendationApprovalService.test.ts \
  src/modules/projectImpactStory/projectImpactStoryImpactCatalog.test.ts \
  src/modules/projectImpactStory/projectImpactStoryStaleness.test.ts
```

Additional note:

- the full backend suite still has two unrelated pre-existing failures in `src/modules/interpretation/interpretationService.test.ts`
- those failures were not introduced by this fix and were not modified here

## What Is Still Not Done

The earlier broader plan included a few items that are still open:

1. UI surfacing of the chosen join key and match diagnostics.
2. Manual join-key override for truly ambiguous datasets.
3. A one-off audit/backfill script for previously persisted historical links in other projects.

These were not required to stop the current bug from recurring on new confirmations, but they would still improve operator visibility and historical cleanup.

## Final Outcome

The bug is fixed at the correct layer.

New confirmed pairings now:

- choose a join key from real cross-table overlap
- reject zero-match joins
- reject ambiguous winners
- persist diagnostics for auditability

Regenerated analytics now:

- no longer converts missing paired results into fake zeros
- becomes stale when confirmed links change

This is a generalized backend fix for new projects with different document layouts, as long as there is at least one real shared key that can be detected from the actual table rows.
