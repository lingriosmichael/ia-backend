import assert from "node:assert/strict";
import test from "node:test";
import { deriveEvidenceStrength } from "./evidenceStrength.js";

test("confidence below 0.4 is weak", () => {
  assert.equal(deriveEvidenceStrength(0), "weak");
  assert.equal(deriveEvidenceStrength(0.39), "weak");
});

test("confidence from 0.4 up to (not including) 0.7 is moderate", () => {
  assert.equal(deriveEvidenceStrength(0.4), "moderate");
  assert.equal(deriveEvidenceStrength(0.69), "moderate");
});

test("confidence of 0.7 and above is strong", () => {
  assert.equal(deriveEvidenceStrength(0.7), "strong");
  assert.equal(deriveEvidenceStrength(1), "strong");
});
