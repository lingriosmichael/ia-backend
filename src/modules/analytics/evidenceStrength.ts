import type { EvidenceStrength } from "./analyticsContracts.js";

// Deterministic bucketing of a KnowledgeIndicator's numeric confidence
// (0-1, same convention as every other confidence field in this codebase)
// into the three labels an LLM is allowed to cite but never invent — see
// EvidenceCatalogMetricEntry.evidenceStrength.
export function deriveEvidenceStrength(confidence: number): EvidenceStrength {
  if (confidence < 0.4) {
    return "weak";
  }
  if (confidence < 0.7) {
    return "moderate";
  }
  return "strong";
}
