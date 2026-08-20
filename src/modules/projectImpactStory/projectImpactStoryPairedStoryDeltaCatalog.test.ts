import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { OutcomeEvidencePairingEvidenceLoaderDependencies } from "../outcome/outcomeEvidencePairingEvidenceLoader.js";
import { buildProjectImpactStoryPairedStoryDeltaCatalog } from "./projectImpactStoryPairedStoryDeltaCatalog.js";

function buildPairingDeps(): OutcomeEvidencePairingEvidenceLoaderDependencies {
  const activities = [{ id: "activity-workshop", systemType: null }];
  const uploads = [{ id: "upload-workshop", activityId: "activity-workshop" }];
  const results = [
    { id: "result-workshop", uploadMetadataId: "upload-workshop" },
  ];
  const preparations = [
    {
      interpretationResultId: "result-workshop",
      status: "ready_for_analysis",
      preparedDataset: {
        isReadyForDeterministicAnalysis: true,
        tables: [
          {
            name: "workshop_feedback",
            identifierColumn: "teilnehmer_id",
            cohortTag: null,
            columns: [
              {
                name: "verstaendnis_vorher",
                epistemicRole: "validated_scale",
                minValue: 1,
                maxValue: 5,
                pairingGroupKey: "Verstaendnis Skala",
                pairingGroupRole: "before",
              },
              {
                name: "verstaendnis_nachher",
                epistemicRole: "validated_scale",
                minValue: 1,
                maxValue: 5,
                pairingGroupKey: "Verstaendnis Skala",
                pairingGroupRole: "after",
              },
            ],
          },
        ],
      },
    },
  ];

  return {
    activityRepository: { listByProject: async () => activities },
    uploadMetadataRepository: {
      listByActivityIds: async () => uploads,
    },
    interpretationResultRepository: {
      findLatestByUploadMetadataIds: async () => results,
    },
    datasetPreparationRepository: {
      findByInterpretationResultIds: async () => preparations,
    },
    privacySafeRepresentationRepository: {
      findLatestByUploadMetadataIds: async () => [
        { uploadMetadataId: "upload-workshop", payload: { tables: [] } },
      ],
    },
  } as unknown as OutcomeEvidencePairingEvidenceLoaderDependencies;
}

function buildToolExecutor(pairedRows: number): ActivityAnalysisV2ToolExecutor {
  return {
    execute: async () => ({
      toolCallTrace: [],
      qualitativeFindings: [],
      calculations: [
        {
          calculationId: "count",
          toolName: "count_rows",
          value: 20,
          result: {},
        },
        {
          calculationId: "delta",
          toolName: "paired_change",
          value: null,
          result: { meanPre: 2.1, meanPost: 3.4, pairedCount: pairedRows },
        },
      ],
    }),
  } as unknown as ActivityAnalysisV2ToolExecutor;
}

function buildEvidenceLoader(): CurrentActivityEvidenceLoader {
  return {
    load: async (activityId: string) => ({
      organizationId: "org-1",
      projectId: "project-1",
      activityId,
      evidence: [],
      missingPrivacySafeUploads: [],
    }),
  } as unknown as CurrentActivityEvidenceLoader;
}

const NOOP_LOGGER = {
  warn: () => {},
} as unknown as import("fastify").FastifyBaseLogger;

test("builds a paired_story_delta entry for a declared pair with enough matched rows", async () => {
  const entries = await buildProjectImpactStoryPairedStoryDeltaCatalog(
    {
      outcomeEvidencePairingEvidenceLoaderDependencies: buildPairingDeps(),
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: buildToolExecutor(12),
      logger: NOOP_LOGGER,
    },
    "project-1",
    [{ id: "activity-workshop", name: "Workshop" }],
    [],
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "paired_story_delta");
  assert.equal(entries[0]?.beforeValue, 2.1);
  assert.equal(entries[0]?.afterValue, 3.4);
  assert.equal(entries[0]?.nMatched, 12);
  assert.equal(entries[0]?.activityName, "Workshop");
});

test("excludes a candidate below the minimum matched-rows threshold", async () => {
  const entries = await buildProjectImpactStoryPairedStoryDeltaCatalog(
    {
      outcomeEvidencePairingEvidenceLoaderDependencies: buildPairingDeps(),
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: buildToolExecutor(2),
      logger: NOOP_LOGGER,
    },
    "project-1",
    [{ id: "activity-workshop", name: "Workshop" }],
    [],
  );

  assert.deepEqual(entries, []);
});

test("excludes a candidate already confirmed as an OutcomeEvidenceLink", async () => {
  const entries = await buildProjectImpactStoryPairedStoryDeltaCatalog(
    {
      outcomeEvidencePairingEvidenceLoaderDependencies: buildPairingDeps(),
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: buildToolExecutor(12),
      logger: NOOP_LOGGER,
    },
    "project-1",
    [{ id: "activity-workshop", name: "Workshop" }],
    [
      {
        linkId: "link-1",
        outcomeId: "outcome-1",
        shape: "paired_delta",
        activityIdBefore: "activity-workshop",
        activityIdAfter: "activity-workshop",
        beforeUploadMetadataId: "upload-workshop",
        beforeTableName: "workshop_feedback",
        beforeColumnName: "verstaendnis_vorher",
        afterUploadMetadataId: "upload-workshop",
        afterTableName: "workshop_feedback",
        afterColumnName: "verstaendnis_nachher",
        matchKey: "teilnehmer_id",
        pairingGroupKey: "Verstaendnis Skala",
        confirmedById: "user-1",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        organizationId: "org-1",
        projectId: "project-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  );

  assert.deepEqual(entries, []);
});
