import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonthValue } from "./monthValue.js";

test("normalizeMonthValue keeps canonical YYYY-MM values", () => {
  assert.equal(normalizeMonthValue("2026-01"), "2026-01");
  assert.equal(normalizeMonthValue("2026-1"), "2026-01");
});

test("normalizeMonthValue converts MM/YYYY values to YYYY-MM", () => {
  assert.equal(normalizeMonthValue("01/2026"), "2026-01");
  assert.equal(normalizeMonthValue("1/2026"), "2026-01");
});

test("normalizeMonthValue rejects impossible month values", () => {
  assert.equal(normalizeMonthValue("13/2026"), null);
  assert.equal(normalizeMonthValue("2026-00"), null);
  assert.equal(normalizeMonthValue("2026/01"), null);
});
