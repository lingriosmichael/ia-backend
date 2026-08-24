import assert from "node:assert/strict";
import test from "node:test";
import { matchesFilter } from "./activityAnalysisV2ToolRowResolution.js";

test("matchesFilter compares a numeric row value against a numeric-string filter value numerically", () => {
  // Regression test for a real bug: normalizeFilterValue coerces string
  // filter values like "1"/"yes"/"ja" to real booleans (correct for
  // flag-shaped columns), but a genuinely numeric row value was never
  // coerced the same way — `numericColumn equals "1"` used to compare
  // Set{true}.has(1) and silently match nothing. See
  // activityAnalysisV2ToolRowResolution.ts's matchesFilter equals/in branch.
  const row = { attendance_count: 1 };
  assert.equal(
    matchesFilter(row, {
      columnName: "attendance_count",
      operator: "equals",
      value: "1",
    }),
    true,
  );
  assert.equal(
    matchesFilter(row, {
      columnName: "attendance_count",
      operator: "not_equals",
      value: "1",
    }),
    false,
  );
  assert.equal(
    matchesFilter(row, {
      columnName: "attendance_count",
      operator: "in",
      value: ["0", "1"],
    }),
    true,
  );
});

test("matchesFilter still boolean-coerces string/flag-shaped row values", () => {
  const row = { ziel_erreicht: "ja" };
  assert.equal(
    matchesFilter(row, {
      columnName: "ziel_erreicht",
      operator: "equals",
      value: "true",
    }),
    true,
  );
  assert.equal(
    matchesFilter(row, {
      columnName: "ziel_erreicht",
      operator: "equals",
      value: "nein",
    }),
    false,
  );
});

test("matchesFilter equals still matches plain numeric equality with a numeric filter value", () => {
  const row = { attendance_count: 4 };
  assert.equal(
    matchesFilter(row, {
      columnName: "attendance_count",
      operator: "equals",
      value: 4,
    }),
    true,
  );
});
