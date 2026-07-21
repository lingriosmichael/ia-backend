import {
  evidenceStrengthValues,
  type EvidenceCatalog,
  type EvidenceCatalogEntry,
  type EvidenceStrength,
  type ReportReadinessCheckResult,
  type ReportReadinessDeviationFinding,
  type ReportReadinessEvidenceSummaryRow,
  type ReportReadinessFinding,
  type ReportReadinessGapFinding,
  type ReportReadinessHonestStory,
} from "../analytics/analyticsContracts.js";

const EVIDENCE_STRENGTH_RANK = new Map<EvidenceStrength, number>(
  evidenceStrengthValues.map((strength, index) => [strength, index]),
);

/**
 * Re-derives every catalog-entry-derived field of a Report Readiness Check
 * response from the real, current EvidenceCatalog instead of trusting
 * whatever the Python service already computed — the same "an LLM-
 * hallucinated id simply has no effect" defense AnalyticsDashboardBuilderService
 * already applies to dashboard curation (see buildSummaryWidget/buildKpiWidgets
 * in analyticsDashboardBuilderService.ts).
 *
 * Python's own grounding validator (app/analytics/grounding.py) already
 * rejects a draft citing an unknown entry or citing nothing at all, so in
 * the common case this is a no-op. It matters when the two services'
 * catalogs briefly disagree (e.g. this request raced a rebuild that
 * changed entry ids) or if a future bug in Python's grounding lets
 * something through — the codebase's own rule is that AI output must be
 * validated at every boundary it crosses, not just the first one.
 */
export function groundReportReadinessCheckResult(
  response: Omit<ReportReadinessCheckResult, "generatedAt">,
  catalog: EvidenceCatalog,
): Omit<ReportReadinessCheckResult, "generatedAt"> {
  const entriesById = new Map<string, EvidenceCatalogEntry>(
    catalog.entries.map((entry) => [entry.entryId, entry]),
  );
  const omittedEntryIds = new Set(
    catalog.omittedEntries.map((entry) => entry.knowledgeEntityId),
  );

  return {
    ...response,
    evidenceSummary: response.evidenceSummary
      .map((row) => groundEvidenceSummaryRow(row, entriesById))
      .filter((row): row is ReportReadinessEvidenceSummaryRow => row !== null),
    confidentlyReportable: response.confidentlyReportable
      .map((finding) => groundFinding(finding, entriesById))
      .filter((finding): finding is ReportReadinessFinding => finding !== null),
    reportableWithCaveats: response.reportableWithCaveats
      .map((finding) => groundFinding(finding, entriesById))
      .filter((finding): finding is ReportReadinessFinding => finding !== null),
    missingOrWeakEvidence: response.missingOrWeakEvidence.map((gap) =>
      groundGapFinding(gap, omittedEntryIds),
    ),
    deviationsRequiringExplanation: response.deviationsRequiringExplanation
      .map((deviation) => groundDeviationFinding(deviation, entriesById))
      .filter(
        (deviation): deviation is ReportReadinessDeviationFinding =>
          deviation !== null,
      ),
    honestEmergingStory: groundHonestStory(
      response.honestEmergingStory,
      entriesById,
    ),
  };
}

function groundedSourceEntryIds(
  sourceEntryIds: string[],
  entriesById: Map<string, EvidenceCatalogEntry>,
): string[] {
  return sourceEntryIds.filter((entryId) => entriesById.has(entryId));
}

function sourceLabelsFor(
  groundedIds: string[],
  entriesById: Map<string, EvidenceCatalogEntry>,
): string[] {
  return groundedIds.map((entryId) => entriesById.get(entryId)?.label ?? "");
}

function weakestEvidenceStrengthFor(
  groundedIds: string[],
  entriesById: Map<string, EvidenceCatalogEntry>,
): EvidenceStrength | null {
  const strengths = groundedIds
    .map((entryId) => entriesById.get(entryId))
    .filter(
      (
        entry,
      ): entry is Extract<EvidenceCatalogEntry, { entryType: "METRIC" }> =>
        entry?.entryType === "METRIC",
    )
    .map((entry) => entry.evidenceStrength);

  if (strengths.length === 0) {
    return null;
  }

  return strengths.reduce((weakest, current) =>
    (EVIDENCE_STRENGTH_RANK.get(current) ?? 0) <
    (EVIDENCE_STRENGTH_RANK.get(weakest) ?? 0)
      ? current
      : weakest,
  );
}

function groundFinding(
  finding: ReportReadinessFinding,
  entriesById: Map<string, EvidenceCatalogEntry>,
): ReportReadinessFinding | null {
  const groundedIds = groundedSourceEntryIds(
    finding.sourceEntryIds,
    entriesById,
  );
  if (groundedIds.length === 0) {
    // Every cited entry was unknown to this catalog — an uncited claim
    // must not be shown, matching the "a claim with no citation should not
    // appear" rule Python's own grounding validator already enforces.
    return null;
  }

  return {
    ...finding,
    sourceEntryIds: groundedIds,
    sourceLabels: sourceLabelsFor(groundedIds, entriesById),
    evidenceStrength: weakestEvidenceStrengthFor(groundedIds, entriesById),
  };
}

function groundEvidenceSummaryRow(
  row: ReportReadinessEvidenceSummaryRow,
  entriesById: Map<string, EvidenceCatalogEntry>,
): ReportReadinessEvidenceSummaryRow | null {
  const groundedIds = groundedSourceEntryIds(row.sourceEntryIds, entriesById);
  if (groundedIds.length === 0) {
    return null;
  }

  return {
    ...row,
    sourceEntryIds: groundedIds,
    sourceLabels: sourceLabelsFor(groundedIds, entriesById),
    confidence: weakestEvidenceStrengthFor(groundedIds, entriesById),
  };
}

function groundDeviationFinding(
  deviation: ReportReadinessDeviationFinding,
  entriesById: Map<string, EvidenceCatalogEntry>,
): ReportReadinessDeviationFinding | null {
  const groundedIds = groundedSourceEntryIds(
    deviation.sourceEntryIds,
    entriesById,
  );
  if (groundedIds.length === 0) {
    return null;
  }

  return {
    ...deviation,
    sourceEntryIds: groundedIds,
    sourceLabels: sourceLabelsFor(groundedIds, entriesById),
    evidenceStrength: weakestEvidenceStrengthFor(groundedIds, entriesById),
  };
}

function groundGapFinding(
  gap: ReportReadinessGapFinding,
  omittedEntryIds: Set<string>,
): ReportReadinessGapFinding {
  // Unlike the claim types above, a gap finding describes a documented
  // absence of evidence — relatedOmittedEntryIds is supplementary context,
  // not the finding's sole grounding, so an unknown id is simply dropped
  // rather than discarding the whole finding.
  return {
    ...gap,
    relatedOmittedEntryIds: gap.relatedOmittedEntryIds.filter((entryId) =>
      omittedEntryIds.has(entryId),
    ),
  };
}

function groundHonestStory(
  story: ReportReadinessHonestStory,
  entriesById: Map<string, EvidenceCatalogEntry>,
): ReportReadinessHonestStory {
  const groundedIds = groundedSourceEntryIds(story.sourceEntryIds, entriesById);
  return {
    ...story,
    sourceEntryIds: groundedIds,
    sourceLabels: sourceLabelsFor(groundedIds, entriesById),
  };
}
