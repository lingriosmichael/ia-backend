import type {
  ActivityAnalysisV2CalculationRecord,
  ImpactIndicatorTile,
  ImpactIndicatorTileFormat,
  ImpactStoryTrendPoint,
} from "../../shared/contracts.js";

// Deliberately an allowlist, not a denylist: several V2 tools (create_cohort,
// first_event/last_event, group_aggregate, the *_set variants, etc.) build
// reusable intermediate results whose numeric `value` is a row/entry count of
// that intermediate table, not a meaningful project metric — displaying it as
// a KPI would show a real-looking but nonsense number. Only tool names
// verified here to carry a terminal, human-meaningful numeric result are
// eligible for a KPI tile. group_count/time_bucket_count are handled
// separately below (their `value` is likewise a bucket count, not the metric
// itself — the metric is their `result.groups`/`result.buckets`).
//
// date_difference, event_gap, days_since_last_event, period_change, and
// paired_change are deliberately excluded even though they sound like KPI
// material: like the reusable-result tools above, their `value` is the row
// count of the reusable result they build (e.g. `resultRows.length`), not
// the day-gap/change figure itself. A later tool reads their real numbers
// out of `result` (e.g. `result.maxGapDaysOverall`, `result.percentChange`);
// they were never meant to be displayed directly as a KPI.
export const KPI_TOOL_NAMES = new Set([
  "count_rows",
  "count_distinct",
  "count_distinct_keys",
  "profile_column",
  "aggregate_numeric",
  "intersection_count",
  "union_count",
  "calculate_ratio",
  "calculate_difference",
  "calculate_percent_change",
  "calculate_sum",
  "calculate_product",
]);

function buildTrendPoints(buckets: unknown): ImpactStoryTrendPoint[] {
  if (!Array.isArray(buckets)) {
    return [];
  }
  return buckets.flatMap((entry): ImpactStoryTrendPoint[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const bucket = (entry as Record<string, unknown>).bucket;
    const count = (entry as Record<string, unknown>).count;
    if (typeof bucket !== "string" || typeof count !== "number") {
      return [];
    }
    return [
      { period: bucket, count, numeratorCount: null, denominatorCount: null },
    ];
  });
}

function buildCategoryBuckets(
  groups: unknown,
): Array<{ category: string; count: number }> {
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const value = (entry as Record<string, unknown>).value;
    const count = (entry as Record<string, unknown>).count;
    if (typeof value !== "string" || typeof count !== "number") {
      return [];
    }
    return [{ category: value, count }];
  });
}

type ProjectImpactStoryLanguage = "de" | "en";

// calculation.label/description are internal provenance text — written for
// engineers verifying the deterministic tool-execution engine (e.g. "Row
// count for auswahlmatrix_mentorinnen - Auswahl", "Counts distinct member
// values across the union of two deterministic sources"). Never render them
// directly; an NGO programme lead has no context for that vocabulary. This
// is the single place that translates a calculation into plain,
// user-facing wording, keyed on the small closed set of tool names actually
// eligible for display (see KPI_TOOL_NAMES and the two cases handled
// directly below) — a switch, not a lookup table, so TypeScript enforces
// that every eligible tool has real copy and nothing can silently fall back
// to the internal text.
function resultString(
  result: Record<string, unknown>,
  key: string,
): string | null {
  const value = result[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function primarySource(
  calculation: ActivityAnalysisV2CalculationRecord,
  language: ProjectImpactStoryLanguage,
): string {
  return (
    resultString(calculation.result, "sourceLabel") ??
    calculation.sourceTableNames[0] ??
    (language === "de" ? "den hochgeladenen Daten" : "the uploaded data")
  );
}

function describeCalculationForUsers(
  calculation: ActivityAnalysisV2CalculationRecord,
  language: ProjectImpactStoryLanguage,
): { label: string; description: string } {
  const source = primarySource(calculation, language);
  const column = calculation.sourceColumns[0] ?? null;

  switch (calculation.toolName) {
    case "count_rows":
      return language === "de"
        ? {
            label: `Einträge in ${source}`,
            description: "Gesamtzahl der gezählten Datensätze.",
          }
        : {
            label: `Entries in ${source}`,
            description: "Total number of records counted.",
          };

    case "count_distinct":
      return language === "de"
        ? {
            label: `Eindeutige Werte für ${column ?? source} in ${source}`,
            description: `Wie viele unterschiedliche Angaben für ${column ?? "dieses Merkmal"} vorkommen.`,
          }
        : {
            label: `Unique ${column ?? "value"}s in ${source}`,
            description: `How many different values for ${column ?? "this"} appear.`,
          };

    case "count_distinct_keys": {
      const columns = calculation.sourceColumns.join(", ");
      return language === "de"
        ? {
            label: `Eindeutige Kombinationen (${columns}) in ${source}`,
            description:
              "Zählt eindeutige Kombinationen dieser Angaben zusammen.",
          }
        : {
            label: `Unique combinations (${columns}) in ${source}`,
            description: "Counts unique combinations of these together.",
          };
    }

    case "profile_column":
      return language === "de"
        ? {
            label: `Übersicht zu ${column ?? source} in ${source}`,
            description:
              "Zeigt, wie vollständig und vielfältig die Angaben sind.",
          }
        : {
            label: `Overview of ${column ?? source} in ${source}`,
            description: "Shows how complete and varied the values are.",
          };

    case "aggregate_numeric": {
      const operation = resultString(calculation.result, "operation");
      const labels: Record<
        string,
        {
          label: { de: string; en: string };
          description: { de: string; en: string };
        }
      > = {
        sum: {
          label: {
            de: `Summe von ${column ?? source} in ${source}`,
            en: `Total ${column ?? source} in ${source}`,
          },
          description: {
            de: "Addiert die Werte über alle passenden Datensätze.",
            en: "Adds up the value across all matching records.",
          },
        },
        avg: {
          label: {
            de: `Durchschnitt von ${column ?? source} in ${source}`,
            en: `Average ${column ?? source} in ${source}`,
          },
          description: {
            de: "Der typische Wert über alle passenden Datensätze.",
            en: "The typical value across all matching records.",
          },
        },
        min: {
          label: {
            de: `Niedrigster Wert von ${column ?? source} in ${source}`,
            en: `Lowest ${column ?? source} in ${source}`,
          },
          description: {
            de: "Der kleinste erfasste Wert.",
            en: "The smallest value recorded.",
          },
        },
        max: {
          label: {
            de: `Höchster Wert von ${column ?? source} in ${source}`,
            en: `Highest ${column ?? source} in ${source}`,
          },
          description: {
            de: "Der größte erfasste Wert.",
            en: "The largest value recorded.",
          },
        },
      };
      const entry = (operation && labels[operation]) || labels.sum!;
      return {
        label: entry.label[language],
        description: entry.description[language],
      };
    }

    case "intersection_count": {
      const left =
        resultString(calculation.result, "leftSourceLabel") ?? source;
      const right =
        resultString(calculation.result, "rightSourceLabel") ?? source;
      return language === "de"
        ? {
            label: `Überschneidung zwischen ${left} und ${right}`,
            description: "Wie viele Einträge in beiden vorkommen.",
          }
        : {
            label: `Overlap between ${left} and ${right}`,
            description: "How many entries appear in both.",
          };
    }

    case "union_count": {
      const left =
        resultString(calculation.result, "leftSourceLabel") ?? source;
      const right =
        resultString(calculation.result, "rightSourceLabel") ?? source;
      return language === "de"
        ? {
            label: `Gesamtzahl über ${left} und ${right}`,
            description: "Wie viele eindeutige Einträge insgesamt vorkommen.",
          }
        : {
            label: `Combined total across ${left} and ${right}`,
            description: "How many unique entries appear across both together.",
          };
    }

    // These five accept an optional planner-supplied label and default to an
    // already-plain fallback ("Calculated ratio", etc.) when none is given —
    // the label itself is left untouched. Only their hardcoded description
    // needs rewriting: today it explicitly says "numerator"/"denominator"/
    // "formula", the exact engineering vocabulary this function exists to
    // avoid.
    case "calculate_ratio":
      return {
        label: calculation.label,
        description:
          language === "de"
            ? "Ein berechnetes Verhältnis zwischen zwei bereits ermittelten Werten in dieser Analyse."
            : "A calculated ratio between two figures already computed in this analysis.",
      };

    case "calculate_difference":
      return {
        label: calculation.label,
        description:
          language === "de"
            ? "Der berechnete Unterschied zwischen zwei bereits ermittelten Werten in dieser Analyse."
            : "The calculated difference between two figures already computed in this analysis.",
      };

    case "calculate_percent_change":
      return {
        label: calculation.label,
        description:
          language === "de"
            ? "Die prozentuale Veränderung zwischen zwei bereits ermittelten Werten in dieser Analyse."
            : "The percentage change between two figures already computed in this analysis.",
      };

    case "calculate_sum":
      return {
        label: calculation.label,
        description:
          language === "de"
            ? "Die Summe der zugehörigen Werte in dieser Analyse."
            : "The combined total of the related figures in this analysis.",
      };

    case "calculate_product":
      return {
        label: calculation.label,
        description:
          language === "de"
            ? "Das Ergebnis der Multiplikation der zugehörigen Werte in dieser Analyse."
            : "The combined result of multiplying the related figures in this analysis.",
      };

    case "group_count":
      return language === "de"
        ? {
            label: `Verteilung von ${column ?? source} in ${source}`,
            description: "Wie sich die Einträge auf die Kategorien verteilen.",
          }
        : {
            label: `Breakdown of ${column ?? source} in ${source}`,
            description: "How entries are distributed across categories.",
          };

    case "time_bucket_count":
      return language === "de"
        ? {
            label: `${column ?? source} im Zeitverlauf in ${source}`,
            description: "Wie sich die Einträge über die Zeit verteilen.",
          }
        : {
            label: `${column ?? source} over time in ${source}`,
            description: "How entries are distributed over time.",
          };

    default:
      // Unreachable for any tool actually routed here by
      // buildCalculationDisplayTile below (group_count, time_bucket_count,
      // and members of KPI_TOOL_NAMES) — every one of those is a case above.
      return { label: calculation.label, description: calculation.description };
  }
}

// The single place that decides whether a V2 calculation is safe to show a
// human, and what shape it takes if so. Reused by projectImpactStoryAssembly
// (per-activity tiles) and projectImpactStoryCatalog (the LLM-facing facts
// catalog for chart planning) so both surfaces agree on what counts as a
// real, displayable project fact.
export function buildCalculationDisplayTile(
  calculation: ActivityAnalysisV2CalculationRecord,
  language: ProjectImpactStoryLanguage,
): ImpactIndicatorTile | null {
  if (calculation.toolName === "group_count") {
    const buckets = buildCategoryBuckets(calculation.result.groups);
    if (buckets.length === 0) {
      return null;
    }
    const { label, description } = describeCalculationForUsers(
      calculation,
      language,
    );
    return {
      kind: "category_rank",
      indicatorId: calculation.calculationId,
      label,
      description,
      buckets,
    };
  }

  if (calculation.toolName === "time_bucket_count") {
    const points = buildTrendPoints(calculation.result.buckets);
    if (points.length === 0) {
      return null;
    }
    const { label, description } = describeCalculationForUsers(
      calculation,
      language,
    );
    return {
      kind: "line_series",
      indicatorId: calculation.calculationId,
      label,
      description,
      points,
    };
  }

  if (
    KPI_TOOL_NAMES.has(calculation.toolName) &&
    typeof calculation.value === "number"
  ) {
    const formatAs: ImpactIndicatorTileFormat =
      calculation.unit === "ratio" ? "percentage" : "number";
    const { label, description } = describeCalculationForUsers(
      calculation,
      language,
    );
    return {
      kind: "kpi",
      indicatorId: calculation.calculationId,
      label,
      description,
      value: calculation.value,
      formatAs,
    };
  }

  return null;
}
