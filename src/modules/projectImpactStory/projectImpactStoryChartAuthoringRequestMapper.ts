import type { ImpactCatalogItem } from "../../shared/contracts.js";
import type { ProjectImpactStoryChartAuthoringCatalogEntryRequest } from "../processing/pythonProcessingClient.js";
import type { ProjectImpactStoryCatalogEntry } from "./projectImpactStoryCatalog.js";

// Successor to toProjectImpactStoryChartPlanRequestEntries
// (projectImpactStoryCatalog.ts) — same "reduce the internal
// discriminated-union catalog to the wire shape Python actually needs"
// job, but now (a) passes real shares/values through for
// context_distribution/paired_story_delta instead of the old lossy
// description-string stub, and (b) also maps confirmed impactCatalog
// entries into the same request array, so the LLM can design charts
// around them alongside the grounded-but-unconfirmed kinds. Kept as its
// own file rather than folded into projectImpactStoryCatalog.ts, which
// has no reason to know about ImpactCatalogItem — that file's job is
// building the grounded catalog, not the merged chart-authoring request.
//
// unmeasured impactCatalog entries are filtered out before this function
// is even reached (by the caller) — an outcome with no linked evidence
// has no real numbers to chart, so there is nothing for this mapper to do
// with it.
export function toProjectImpactStoryChartAuthoringRequestEntries(
  catalog: ProjectImpactStoryCatalogEntry[],
  impactCatalog: ImpactCatalogItem[],
  // Same rationale as toProjectImpactStoryChartPlanRequestEntries's
  // identical parameter — see that function's own comment.
  goalDisplayLabelsByGoalText: Map<string, string> = new Map(),
): ProjectImpactStoryChartAuthoringCatalogEntryRequest[] {
  const groundedEntries: ProjectImpactStoryChartAuthoringCatalogEntryRequest[] =
    catalog.map((entry) => {
      if (entry.kind === "calculation") {
        return {
          entryId: entry.entryId,
          kind: "calculation",
          activityId: entry.activityId,
          activityName: entry.activityName,
          label: entry.tile.label,
          description: entry.tile.description,
          toolName: entry.toolName,
          unit: entry.unit,
          value: entry.tile.kind === "kpi" ? entry.tile.value : null,
        };
      }

      if (entry.kind === "context_distribution") {
        return {
          entryId: entry.entryId,
          kind: "context_distribution",
          activityId: entry.activityId,
          activityName: entry.activityName,
          label: entry.labelDe,
          description: `${entry.dimensionLabelDe}. ${entry.sourceDe}`,
          shares: entry.shares.map((share) => ({
            label: share.labelDe,
            count: share.count,
          })),
          n: entry.n,
        };
      }

      if (entry.kind === "paired_story_delta") {
        return {
          entryId: entry.entryId,
          kind: "paired_story_delta",
          activityId: entry.activityId,
          activityName: entry.activityName,
          label: entry.pairLabelDe,
          description: `Exploratory before/after evidence, not confirmed outcome measurement. ${entry.sourceDe}`,
          beforeValue: entry.beforeValue,
          afterValue: entry.afterValue,
          nMatched: entry.nMatched,
          nBaseline: entry.nBaseline,
        };
      }

      return {
        entryId: entry.entryId,
        kind: "goal_assessment",
        activityId: entry.activityId,
        activityName: entry.activityName,
        label:
          goalDisplayLabelsByGoalText.get(entry.goalText) ?? entry.goalText,
        description: null,
        goalType: entry.goalType,
        assessmentStatus: entry.assessmentStatus,
        achieved: entry.achieved,
      };
    });

  const confirmedEntries: ProjectImpactStoryChartAuthoringCatalogEntryRequest[] =
    impactCatalog.flatMap(
      (entry): ProjectImpactStoryChartAuthoringCatalogEntryRequest[] => {
        // paired_delta is deliberately excluded here (2026-08-30) — it's
        // handled entirely by the deterministic
        // projectImpactStoryConfirmedPairedDeltaCharts.ts instead, which
        // always groups every confirmed pair into one always-rendered
        // chart with no LLM involvement. Sending it into chart-authoring
        // too would risk it appearing twice.
        if (entry.shape === "paired_delta") {
          return [];
        }

        if (entry.shape === "paired_categorical_shift") {
          return [
            {
              entryId: entry.entryId,
              kind: "confirmed_paired_categorical_shift" as const,
              outcomeId: entry.outcomeId,
              outcomeTerm: entry.outcomeTerm,
              outcomeStatement: entry.outcomeStatement,
              pairLabel: entry.pairLabelDe,
              beforeShares: entry.beforeShares.map((share) => ({
                label: share.labelDe,
                count: share.count,
              })),
              afterShares: entry.afterShares.map((share) => ({
                label: share.labelDe,
                count: share.count,
              })),
              nMatched: entry.nMatched,
              nBaseline: entry.nBaseline,
            },
          ];
        }

        if (entry.shape === "single_distribution") {
          return [
            {
              entryId: entry.entryId,
              kind: "confirmed_single_distribution" as const,
              outcomeId: entry.outcomeId,
              outcomeTerm: entry.outcomeTerm,
              outcomeStatement: entry.outcomeStatement,
              questionLabel: entry.questionLabelDe,
              shares: entry.shares.map((share) => ({
                label: share.labelDe,
                count: share.count,
              })),
              n: entry.n,
            },
          ];
        }

        // "unmeasured" — nothing chartable; excluded rather than mapped.
        return [];
      },
    );

  return [...groundedEntries, ...confirmedEntries];
}
