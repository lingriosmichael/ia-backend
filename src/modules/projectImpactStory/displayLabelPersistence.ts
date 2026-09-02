import { createHash } from "node:crypto";

export type DisplayLabelLanguage = "de" | "en";

export interface DisplayLabelPersistenceRecord {
  key: string;
  sourceText: string;
  language: DisplayLabelLanguage;
  displayLabel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisplayLabelCreateInput {
  key: string;
  sourceText: string;
  language: DisplayLabelLanguage;
  displayLabel: string;
}

// Same sha1-prefix-slice convention activityAnalysisV2ToolRowResolution.ts
// already uses for content-addressed ids elsewhere in this codebase.
// sourceText is used verbatim (not trimmed/normalized) so the cache key
// matches exactly what gets sent to the LLM — a normalization step here
// that the generation call doesn't also apply would silently desync the
// two.
export function buildDisplayLabelKey(
  sourceText: string,
  language: DisplayLabelLanguage,
): string {
  const digest = createHash("sha1")
    .update(`${language}::${sourceText}`)
    .digest("hex")
    .slice(0, 24);
  return `display_label_${digest}`;
}
