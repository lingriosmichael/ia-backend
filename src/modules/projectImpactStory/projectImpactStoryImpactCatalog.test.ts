import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { DatasetPreparationRepository } from "../interpretation/datasetPreparationRepository.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "../outcome/projectOutcomeStatementPersistence.js";
import { buildProjectImpactStoryImpactCatalog } from "./projectImpactStoryImpactCatalog.js";

const NOW = new Date("2026-08-20T10:00:00.000Z");

const noopLogger = {
  warn: () => {},
} as unknown as FastifyBaseLogger;

// No test in this file exercises scaleDirection resolution specifically —
// these stubs just let resolvePairedDeltaScaleDirection's own empty-results
// early-return resolve to null, matching every existing assertion here
// (field-level, never a whole-entry deepEqual that a new field would break).
const emptyInterpretationResultRepository = {
  async findLatestByUploadMetadataIds() {
    return [];
  },
} as unknown as InterpretationResultRepository;

const emptyDatasetPreparationRepository = {
  async findByInterpretationResultIds() {
    return [];
  },
} as unknown as DatasetPreparationRepository;

// Empty on purpose: the source-caption builders both fall back to a bare
// table name when an activity name isn't found, so every test here that
// doesn't specifically care about the caption's exact text is unaffected
// — see the dedicated source-caption tests below, which pass a populated
// map instead.
const emptyActivityNameById = new Map<string, string>();

function buildEvidenceLoader(): CurrentActivityEvidenceLoader {
  return {
    async load(activityId: string) {
      return {
        organizationId: "org-1",
        projectId: "project-1",
        activityId,
        evidence: [],
        missingPrivacySafeUploads: [],
      };
    },
  } as unknown as CurrentActivityEvidenceLoader;
}

function buildOutcome(
  overrides: Partial<ProjectOutcomeStatementPersistenceRecord> = {},
): ProjectOutcomeStatementPersistenceRecord {
  return {
    id: "outcome-1",
    projectId: "project-1",
    organizationId: "org-1",
    term: "short",
    statement: "Jugendliche kennen ihre naechsten Schritte.",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function calculation(
  toolName: ActivityAnalysisV2CalculationRecord["toolName"],
  value: ActivityAnalysisV2CalculationRecord["value"],
  result: Record<string, unknown>,
): ActivityAnalysisV2CalculationRecord {
  return {
    calculationId: `${toolName}-1`,
    toolName,
    label: toolName,
    description: toolName,
    formula: null,
    value,
    unit: null,
    sourceUploadMetadataIds: [],
    sourceTableNames: [],
    sourceColumns: [],
    result,
  };
}

test("an outcome with zero confirmed links produces no impact-catalog entry", async () => {
  const executor = {
    async execute() {
      throw new Error("should not be called when no links exist");
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [],
  );

  assert.equal(items.length, 0);
});

test("a confirmed paired_delta link resolves via join_tables + paired_change and reports nMatched from the join, not independent aggregates", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 42, {}),
          calculation("join_tables", 12, {}),
          calculation("paired_change", 12, {
            pairedCount: 12,
            meanPre: 2.1,
            meanPost: 3.4,
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "selbstwirksamkeit_baseline_1_5",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "selbstwirksamkeit_abschluss_1_5",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Selbstwirksamkeit",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  assert.equal(items.length, 1);
  const entry = items[0];
  assert.equal(entry?.shape, "paired_delta");
  if (entry?.shape !== "paired_delta") {
    throw new Error("expected paired_delta entry");
  }
  assert.equal(entry.nMatched, 12);
  assert.equal(entry.nBaseline, 42);
  assert.equal(entry.beforeValue, 2.1);
  assert.equal(entry.afterValue, 3.4);
  assert.equal(
    entry.outcomeStatement,
    "Jugendliche kennen ihre naechsten Schritte.",
  );
  // No scale_direction question answered on either column (empty stub
  // repositories) — must resolve to null, never default to a direction.
  assert.equal(entry.scaleDirection, null);
});

test("a paired_delta entry's scaleDirection is 'higher_is_better' when both before/after columns declare it", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 42, {}),
          calculation("join_tables", 12, {}),
          calculation("paired_change", 12, {
            pairedCount: 12,
            meanPre: 2.1,
            meanPost: 3.4,
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "selbstwirksamkeit_baseline_1_5",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "selbstwirksamkeit_abschluss_1_5",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Selbstwirksamkeit",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const interpretationResultRepository = {
    async findLatestByUploadMetadataIds() {
      return [
        { id: "result-before", uploadMetadataId: "upload-before" },
        { id: "result-after", uploadMetadataId: "upload-after" },
      ];
    },
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    async findByInterpretationResultIds() {
      return [
        {
          uploadMetadataId: "upload-before",
          preparedDataset: {
            tables: [
              {
                name: "wirkungsmessung_baseline",
                columns: [
                  {
                    name: "selbstwirksamkeit_baseline_1_5",
                    scaleDirection: "higher_is_better",
                  },
                ],
              },
            ],
          },
        },
        {
          uploadMetadataId: "upload-after",
          preparedDataset: {
            tables: [
              {
                name: "wirkungsmessung_abschluss",
                columns: [
                  {
                    name: "selbstwirksamkeit_abschluss_1_5",
                    scaleDirection: "higher_is_better",
                  },
                ],
              },
            ],
          },
        },
      ];
    },
  } as unknown as DatasetPreparationRepository;

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository,
      datasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "paired_delta");
  if (entry?.shape !== "paired_delta") {
    throw new Error("expected paired_delta entry");
  }
  assert.equal(entry.scaleDirection, "higher_is_better");
});

test("a paired_delta entry's scaleDirection is 'lower_is_better' when either column declares it, even if the other disagrees", async () => {
  // Conservative-by-design: any signal the item is reverse-scored is
  // enough — see resolvePairedDeltaScaleDirection's own comment for why
  // this asymmetry is deliberate (a false exclude costs nothing; a false
  // include misrepresents the measurement).
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 42, {}),
          calculation("join_tables", 12, {}),
          calculation("paired_change", 12, {
            pairedCount: 12,
            meanPre: 5,
            meanPost: 2,
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "tage_ohne_kontakt_baseline",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "tage_ohne_kontakt_abschluss",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Tage ohne Kontakt",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const interpretationResultRepository = {
    async findLatestByUploadMetadataIds() {
      return [
        { id: "result-before", uploadMetadataId: "upload-before" },
        { id: "result-after", uploadMetadataId: "upload-after" },
      ];
    },
  } as unknown as InterpretationResultRepository;

  const datasetPreparationRepository = {
    async findByInterpretationResultIds() {
      return [
        {
          uploadMetadataId: "upload-before",
          preparedDataset: {
            tables: [
              {
                name: "wirkungsmessung_baseline",
                columns: [
                  {
                    name: "tage_ohne_kontakt_baseline",
                    scaleDirection: "lower_is_better",
                  },
                ],
              },
            ],
          },
        },
        {
          // The after-wave column never got its scale_direction question
          // answered — the before wave's "lower_is_better" alone must
          // still be enough to mark the pair reverse-scored.
          uploadMetadataId: "upload-after",
          preparedDataset: {
            tables: [
              {
                name: "wirkungsmessung_abschluss",
                columns: [
                  {
                    name: "tage_ohne_kontakt_abschluss",
                    scaleDirection: null,
                  },
                ],
              },
            ],
          },
        },
      ];
    },
  } as unknown as DatasetPreparationRepository;

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository,
      datasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "paired_delta");
  if (entry?.shape !== "paired_delta") {
    throw new Error("expected paired_delta entry");
  }
  assert.equal(entry.scaleDirection, "lower_is_better");
});

test("a paired_delta mean that lands on a long repeating decimal is rounded to one decimal place", async () => {
  // Regression test: 105 paired respondents produces means like
  // 2.8095238095238093 / 4.247619047619048 — before this rounding was
  // added, that raw float became "the real value" both the chart tooltip
  // (which happens to round for display anyway) and the narrative LLM
  // (which is required to cite it exactly, unrounded) would show verbatim.
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 130, {}),
          calculation("join_tables", 105, {}),
          calculation("paired_change", 105, {
            pairedCount: 105,
            meanPre: 2.8095238095238093,
            meanPost: 4.247619047619048,
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "selbstsicherheit_baseline_1_5",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "selbstsicherheit_abschluss_1_5",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Selbstsicherheit",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "paired_delta");
  if (entry?.shape !== "paired_delta") {
    throw new Error("expected paired_delta entry");
  }
  assert.equal(entry.beforeValue, 2.8);
  assert.equal(entry.afterValue, 4.2);
  assert.equal(entry.pairLabelDe, "Selbstsicherheit");
});

test("a confirmed single_distribution link resolves via group_count", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("group_count", 30, {
            groups: [
              { value: "Praktikum", count: 18 },
              { value: "Ausbildung", count: 12 },
            ],
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-2",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "single_distribution",
    activityId: "activity-impact-measurement",
    uploadMetadataId: "upload-impact",
    tableName: "wirkungsmessung_abschluss",
    categoryColumnName: "naechster_schritt_art",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  assert.equal(items.length, 1);
  const entry = items[0];
  assert.equal(entry?.shape, "single_distribution");
  if (entry?.shape !== "single_distribution") {
    throw new Error("expected single_distribution entry");
  }
  assert.equal(entry.n, 30);
  assert.deepEqual(entry.shares, [
    { labelDe: "Praktikum", count: 18 },
    { labelDe: "Ausbildung", count: 12 },
  ]);
  assert.equal(entry.questionLabelDe, "Naechster schritt art");
});

test("a single_distribution entry's source caption pairs the table name with its activity's real name", async () => {
  // IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §3: a bare table name is
  // frequently the raw upload filename stem, not a human description.
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [calculation("group_count", 5, { groups: [] })],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-2",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "single_distribution",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    tableName: "06_Wirkungsmessung_Umfrage",
    categoryColumnName: "naechster_schritt_art",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: new Map([
        ["activity-1", "Ausgangslage & Wirkungsdaten"],
      ]),
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "single_distribution");
  if (entry?.shape !== "single_distribution") {
    throw new Error("expected single_distribution entry");
  }
  assert.equal(
    entry.sourceDe,
    "Quelle: Ausgangslage & Wirkungsdaten — 06 Wirkungsmessung Umfrage",
  );
});

test("a paired_delta entry's source caption names the shared activity once, not on both sides of the arrow", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 42, {}),
          calculation("join_tables", 12, {}),
          calculation("paired_change", 12, {
            pairedCount: 12,
            meanPre: 2.1,
            meanPost: 3.4,
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-1",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-1",
    activityIdAfter: "activity-1",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "05_Baseline_Umfrage",
    beforeColumnName: "selbstwirksamkeit_baseline_1_5",
    afterUploadMetadataId: "upload-after",
    afterTableName: "06_Wirkungsmessung_Umfrage",
    afterColumnName: "selbstwirksamkeit_abschluss_1_5",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Selbstwirksamkeit",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: new Map([
        ["activity-1", "Ausgangslage & Wirkungsdaten"],
      ]),
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "paired_delta");
  if (entry?.shape !== "paired_delta") {
    throw new Error("expected paired_delta entry");
  }
  assert.equal(
    entry.sourceDe,
    "Quelle: Ausgangslage & Wirkungsdaten — 05 Baseline Umfrage → 06 Wirkungsmessung Umfrage",
  );
});

test("a confirmed paired_categorical_shift link resolves via join_tables + paired_category_shift", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 20, {}),
          calculation("join_tables", 12, {}),
          calculation("paired_category_shift", 12, {
            pairedCount: 12,
            beforeCounts: [
              { label: "Ja", count: 4 },
              { label: "Nein", count: 8 },
            ],
            afterCounts: [
              { label: "Ja", count: 9 },
              { label: "Nein", count: 3 },
            ],
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const link: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-3",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_categorical_shift",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "status_vorher",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "status_nachher",
    matchKey: "teilnehmer_id",
    pairLabelColumnName: "Status",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [link],
  );

  const entry = items[0];
  assert.equal(entry?.shape, "paired_categorical_shift");
  if (entry?.shape !== "paired_categorical_shift") {
    throw new Error("expected paired_categorical_shift entry");
  }
  assert.equal(entry.nMatched, 12);
  assert.equal(entry.nBaseline, 20);
  assert.deepEqual(entry.beforeShares, [
    { labelDe: "Ja", count: 4 },
    { labelDe: "Nein", count: 8 },
  ]);
  assert.deepEqual(entry.afterShares, [
    { labelDe: "Ja", count: 9 },
    { labelDe: "Nein", count: 3 },
  ]);
});

test("a paired_categorical_shift link whose join produced zero matched pairs is skipped instead of materializing a zero-evidence entry", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 20, {}),
          calculation("join_tables", 0, {}),
          calculation("paired_category_shift", 0, {
            pairedCount: 0,
            beforeCounts: [],
            afterCounts: [],
          }),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const emptyJoinLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-empty-join",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_categorical_shift",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "status_vorher",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "status_nachher",
    matchKey: "teilnehmer_id",
    pairLabelColumnName: "Status",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [emptyJoinLink],
  );

  assert.equal(items.length, 0);
});

test("a link whose evidence can no longer be resolved is skipped, not thrown, so it doesn't block the rest of the catalog", async () => {
  const executor = {
    async execute() {
      throw new Error("column not found");
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const brokenLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-broken",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "single_distribution",
    activityId: "activity-1",
    uploadMetadataId: "upload-1",
    tableName: "table",
    categoryColumnName: "column_that_no_longer_exists",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [brokenLink],
  );

  assert.equal(items.length, 0);
});

test("an orphaned paired_categorical_shift link whose evidence can no longer be resolved is skipped like paired_delta, not thrown", async () => {
  // Regression coverage: a re-upload can remove/rename the column a
  // confirmed link points at. paired_delta already behaves this way via
  // the shared try/catch in buildProjectImpactStoryImpactCatalog; this
  // asserts paired_categorical_shift takes the same non-fatal path rather
  // than assuming shared code always stays shared through future changes.
  const executor = {
    async execute() {
      throw new Error("column not found");
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const orphanedLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-orphaned-categorical",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_categorical_shift",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "column_that_no_longer_exists",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "status_nachher",
    matchKey: "teilnehmer_id",
    pairLabelColumnName: "Status",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [orphanedLink],
  );

  assert.equal(items.length, 0);
});

test("a paired_delta link whose paired_change result is missing is skipped instead of materializing zeroed values", async () => {
  const executor = {
    async execute() {
      return {
        toolCallTrace: [],
        qualitativeFindings: [],
        calculations: [
          calculation("count_rows", 42, {}),
          calculation("join_tables", 12, {}),
        ],
      };
    },
  } as unknown as ActivityAnalysisV2ToolExecutor;

  const brokenLink: OutcomeEvidenceLinkPersistenceRecord = {
    linkId: "link-broken-paired",
    organizationId: "org-1",
    projectId: "project-1",
    outcomeId: "outcome-1",
    shape: "paired_delta",
    activityIdBefore: "activity-baseline",
    activityIdAfter: "activity-impact-measurement",
    beforeUploadMetadataId: "upload-before",
    beforeTableName: "wirkungsmessung_baseline",
    beforeColumnName: "selbstwirksamkeit_baseline_1_5",
    afterUploadMetadataId: "upload-after",
    afterTableName: "wirkungsmessung_abschluss",
    afterColumnName: "selbstwirksamkeit_abschluss_1_5",
    matchKey: "teilnehmer_id",
    pairingGroupKey: "Selbstwirksamkeit",
    confirmedById: "user-1",
    confirmedAt: NOW.toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items = await buildProjectImpactStoryImpactCatalog(
    {
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: executor,
      interpretationResultRepository: emptyInterpretationResultRepository,
      datasetPreparationRepository: emptyDatasetPreparationRepository,
      activityNameById: emptyActivityNameById,
      logger: noopLogger,
    },
    [buildOutcome()],
    [brokenLink],
  );

  assert.equal(items.length, 0);
});
