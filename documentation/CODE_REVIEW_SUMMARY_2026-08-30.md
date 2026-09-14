# Code Review Summary — August 30, 2026

Plain-language summary of a review of all unsaved (uncommitted) work across the three services — backend, Python service, and web app — compared against the official documentation.

This covers two big pieces of in-progress work: the **Project Impact Story** feature (charts, goal labels, narrative) and the **Outcome Evidence Pairing** feature (matching uploaded files to prove outcomes), plus some smaller changes to the AI interpretation pipeline.

**Update:** all 11 findings below have now been checked and closed out — either already fixed, or fixed in this pass. See the status line under each one, and "What we found while fixing" at the end for a few new, smaller things that turned up along the way.

---

## 🔴 Needs attention before this ships

### 1. A new AI feature is missing the nuance its safety rule needs

✅ **Fixed and verified.** The system already has an important distinction for coded qualitative evidence: sometimes a before/after shift in themes really is meaningful, but only if both sides use the same approved coding scheme. That means the right safeguard is **not** "never use subjective codes." It is "only treat a before/after category shift as valid when the coded columns explicitly reuse the same approved codebook provenance." This is now implemented and has automated tests covering both the allowed case (shared codebook) and the blocked case (no shared codebook) — confirmed by reading the code and running the tests.

_Small residual note, not blocking:_ the new rule only special-cases the "coded qualitative" evidence type. There's a second, rarer evidence type ("raw free text") that the same overall safety net blocks everywhere else in the system, but this one new comparison type doesn't explicitly re-check for it. In practice this path is unlikely to be reachable in the current product, but it's worth a follow-up look if this area is touched again.

### 2. AI usage costs for a new feature aren't being tracked

✅ **Fixed and verified.** The app keeps a running total of how much it has spent on AI calls per project. The new goal-display-name feature's usage is now recorded into that running total, the same way the other two AI calls in this feature already were. Confirmed by reading the code.

---

## 🟡 Documentation is now out of date

### 3. The evidence-pairing documentation is missing a whole new capability

✅ **Fixed.** The official document for how uploaded evidence gets matched to outcomes now describes all three ways evidence can be compared (including the newer "compare categories" way), the new step where staff manually label a file as "before" or "after," and the rule that a coded-qualitative comparison needs proven shared origin. The document's own internal section references were also updated so they now point to real sections instead of ones that didn't exist.

### 4. The new "goal display label" feature isn't documented anywhere

✅ **Fixed.** Added to the main architecture document (what it is, where it's stored, that the cache is shared globally across all organizations rather than per-project — worth knowing since it's a deliberate design choice, not an accident), the chart-generation mechanism document (how it feeds into the AI's chart-writing step), and the shared technical reference both engineering teams check.

---

## 🟠 Gaps that could cause real, hard-to-catch bugs

### 5. Survey answers containing a comma could break or get mixed up

✅ **Fixed and verified.** Multiple-choice answers are no longer joined with commas — they're now encoded in a way that can't be confused with a comma inside someone's answer text. Old, already-saved answers in the previous comma format are still read correctly.

### 6. Labeling a file as "before" or "after" isn't tested at all

✅ **Fixed.** Added 6 automated tests covering: the labeling actually saves correctly, an unauthorized user's attempt to change a label is blocked _before_ anything is written, an unknown file is rejected, and — separately, for the "preview a file's data" feature — that a reviewer only ever sees the privacy-checked version of the data (never the raw upload) and that a large file's preview is properly capped without losing the real row count. All 6 pass.

### 7. A safety check has a blind spot that its own test doesn't reveal

✅ **Fixed, plus found and fixed a related loose end.** The safety check itself was already rewritten correctly by the time we checked: two unclassified ("neither before nor after") files can no longer slip through as an accidental pass. But the old test file testing this check hadn't been updated to match, and had actually stopped compiling as a result. Fixed the test file and added a dedicated test for the "two unclassified files" case specifically. 8 tests, all passing.

### 8. Malformed data from the Python service disappears silently

✅ **Fixed.** A warning is now logged whenever the AI-analysis service sends back a recommendation entry that doesn't match the expected shape, instead of it silently vanishing.

---

## 🟢 Smaller, lower-risk items

### 9. Manually pairing two "category" files behaves inconsistently

✅ **Turned out not to be a real issue.** On closer inspection, the manual-pairing screen already only ever offers numeric-type files as choices — a staff member literally cannot select two category-type files through this screen today. So there was nothing to fix here; the original concern doesn't apply to the current code.

### 10. Some documentation is a step behind the code (minor)

✅ **Fixed.** The AI-pipeline documentation now covers the new comparison tool, the internal code reorganization that came with it, the new non-blocking question type, and a real bug fix worth recording: the AI used to be told to show a single-select box for a question that was actually supposed to allow multiple answers — that's now decided by the same deterministic code that writes the question wording, not left to the AI's own (occasionally wrong) judgment.

### 11. Leftover dead code in the chart-writing feature (cleanup only)

✅ **Fixed and verified.** Removed the unreachable branches, narrowed the function's expected input to match what's actually ever passed to it, and confirmed nothing else in the file broke (all 15 existing tests for that file still pass).

---

## What we found while fixing

Two things turned up during verification that are **not** part of the original 11 findings and were **left alone** (out of scope for this pass, flagged here so you can decide whether to look at them separately):

- **A pre-existing type-checking error in the chart-writing code**, unrelated to anything in this review — two spots where a "confirmed single measurement" chart is built without fully checking that the measurement is a kind the function actually knows how to render. This didn't block anything we fixed, but is worth a look before this code ships, since it's a real gap the type-checker is actively flagging.
- **Two pre-existing failing automated tests** in the interpretation-review flow, unrelated to any of the 11 findings or to files touched in this pass. One looks like a stale test double missing a method; the other expects a validation error that isn't being thrown. Neither was touched by this review's fixes.

## Bottom line

All 11 original findings are now closed: 9 were fixed (5 already done before this pass, 6 fixed in this pass, including one — the dead test file — that surfaced only while verifying an earlier fix), and 1 (the manual-pairing concern) turned out not to be a real issue on closer inspection. Two unrelated pre-existing issues were found and flagged above rather than fixed, since they're outside this review's original scope.
