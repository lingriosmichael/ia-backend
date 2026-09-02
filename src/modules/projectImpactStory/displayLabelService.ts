import type { FastifyBaseLogger } from "fastify";
import { databaseSession } from "../../shared/database/databaseClient.js";
import { isMongoDuplicateKeyError } from "../../shared/database/mongoErrors.js";
import type { LlmUsageSummary } from "../../shared/contracts.js";
import { mergeLlmUsage } from "../../shared/utils/llmUsage.js";
import type { PythonProcessingClient } from "../processing/pythonProcessingClient.js";
import type { DisplayLabelRepository } from "./displayLabelRepository.js";
import {
  buildDisplayLabelKey,
  type DisplayLabelLanguage,
} from "./displayLabelPersistence.js";

export interface DisplayLabelServiceDependencies {
  displayLabelRepository: DisplayLabelRepository;
  pythonProcessingClient: PythonProcessingClient;
  logger: FastifyBaseLogger;
}

// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §2 — the caching layer in front of
// PythonProcessingClient.generateDisplayLabel. Content-addressed (see
// buildDisplayLabelKey): most callers have no persisted entity to key a
// cache on (a goal statement is just a parsed line of an activity's
// free-text output field, re-derived with a positional id every V2 run —
// see activityAnalysisV2Service.ts's buildGoals; a chart's bar/category
// label is likewise just a string pulled from a catalog entry, not an
// owning entity), so the exact source text itself is the only stable
// identity available across every caller. An edited source string is a
// fresh cache key, not a stale one to invalidate. Generic across callers —
// goal statements, chart bar/category labels, and any other short
// free-text string that needs a shorter display form all share this one
// cache and code path.
export class DisplayLabelService {
  constructor(private readonly deps: DisplayLabelServiceDependencies) {}

  // Resolves every unique string in texts to a short display label,
  // generating (and caching) only the ones not already cached. Order and
  // duplicates in the input are irrelevant to cost — every distinct string
  // is generated at most once ever, across every project (and every
  // caller) that happens to share it.
  async resolveDisplayLabels(
    texts: string[],
    language: DisplayLabelLanguage,
  ): Promise<{
    labelsByText: Map<string, string>;
    llmUsage: LlmUsageSummary | null;
  }> {
    const uniqueTexts = [...new Set(texts)];
    if (uniqueTexts.length === 0) {
      return { labelsByText: new Map(), llmUsage: null };
    }

    const keyedTexts = uniqueTexts.map((sourceText) => ({
      sourceText,
      key: buildDisplayLabelKey(sourceText, language),
    }));

    const cachedRecords = await this.deps.displayLabelRepository.findByKeys(
      keyedTexts.map((entry) => entry.key),
      databaseSession,
    );
    const cachedByKey = new Map(
      cachedRecords.map((record) => [record.key, record]),
    );

    const result = new Map<string, string>();
    const missing: { sourceText: string; key: string }[] = [];
    for (const entry of keyedTexts) {
      const cached = cachedByKey.get(entry.key);
      if (cached) {
        result.set(entry.sourceText, cached.displayLabel);
      } else {
        missing.push(entry);
      }
    }

    // Sequential, not Promise.all: avoids bursting the LLM provider with N
    // simultaneous calls the first time a project with many distinct
    // strings is opened. Only matters on a cold cache — every later read
    // for the same text is a pure cache hit with zero LLM calls.
    let llmUsage: LlmUsageSummary | null = null;
    for (const entry of missing) {
      const generated = await this.generateAndCache(
        entry.sourceText,
        entry.key,
        language,
      );
      result.set(entry.sourceText, generated.displayLabel);
      llmUsage = mergeLlmUsage(llmUsage, generated.llmUsage);
    }

    return { labelsByText: result, llmUsage };
  }

  private async generateAndCache(
    sourceText: string,
    key: string,
    language: DisplayLabelLanguage,
  ): Promise<{ displayLabel: string; llmUsage: LlmUsageSummary | null }> {
    let response;
    try {
      response = await this.deps.pythonProcessingClient.generateDisplayLabel({
        text: sourceText,
        language,
      });
    } catch (error) {
      // Cosmetic, per §2 — never let a label-generation failure block
      // story generation. The raw source text is always a safe, correct
      // (if unshortened) fallback. No call succeeded, so there's nothing
      // to count in usage tracking.
      this.deps.logger.warn(
        { err: error, sourceText },
        "display label generation failed; falling back to the raw source text",
      );
      return { displayLabel: sourceText, llmUsage: null };
    }

    // Captured before the persistence attempt below: the LLM call already
    // happened and cost real tokens by this point, so it's counted
    // regardless of whether this request wins the write below.
    const llmUsage = response.llmUsage ?? null;

    try {
      const created = await this.deps.displayLabelRepository.create(
        { key, sourceText, language, displayLabel: response.displayLabel },
        databaseSession,
      );
      return { displayLabel: created.displayLabel, llmUsage };
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        // Lost a race with a concurrent request generating the same
        // content-addressed key — use whichever generation the winner
        // wrote rather than treating this as a failure.
        const [existing] = await this.deps.displayLabelRepository.findByKeys(
          [key],
          databaseSession,
        );
        return {
          displayLabel: existing?.displayLabel ?? response.displayLabel,
          llmUsage,
        };
      }
      this.deps.logger.warn(
        { err: error, sourceText },
        "display label generation failed; falling back to the raw source text",
      );
      return { displayLabel: sourceText, llmUsage };
    }
  }
}
