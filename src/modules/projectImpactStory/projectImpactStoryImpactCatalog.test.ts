import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { ActivityAnalysisV2CalculationRecord } from "../../shared/contracts.js";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { OutcomeEvidenceLinkPersistenceRecord } from "../outcome/outcomeEvidenceLinkPersistence.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "../outcome/projectOutcomeStatementPersistence.js";
import { buildProjectImpactStoryImpactCatalog } from "./projectImpactStoryImpactCatalog.js";

const NOW = new Date("2026-08-20T10:00:00.000Z");

const noopLogger = {
  warn: () => {},
} as unknown as FastifyBaseLogger;

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
  assert.equal(entry.pairLabelDe, "Selbstwirksamkeit");
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
      logger: noopLogger,
    },
    [buildOutcome()],
    [brokenLink],
  );

  assert.equal(items.length, 0);
});
