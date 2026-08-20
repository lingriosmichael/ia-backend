import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProjectEvidenceTablesForOutcomePairing,
  loadProjectEvidenceTablesForStoryPairing,
  type OutcomeEvidencePairingEvidenceLoaderDependencies,
} from "./outcomeEvidencePairingEvidenceLoader.js";

// Two activities: one a system activity (baseline), one an ordinary
// activity (e.g. a single workshop with its own before/after feedback
// form) — the exact case loadProjectEvidenceTablesForStoryPairing exists
// for, since loadProjectEvidenceTablesForOutcomePairing's system-activity-
// only scope would never see it.
function buildDeps(): OutcomeEvidencePairingEvidenceLoaderDependencies {
  const activities = [
    { id: "activity-baseline", systemType: "baseline" as const },
    { id: "activity-workshop", systemType: null },
  ];
  const uploads = [
    { id: "upload-baseline", activityId: "activity-baseline" },
    { id: "upload-workshop", activityId: "activity-workshop" },
  ];
  const results = [
    { id: "result-baseline", uploadMetadataId: "upload-baseline" },
    { id: "result-workshop", uploadMetadataId: "upload-workshop" },
  ];
  const preparations = [
    {
      interpretationResultId: "result-baseline",
      status: "ready_for_analysis",
      preparedDataset: {
        isReadyForDeterministicAnalysis: true,
        tables: [
          {
            name: "baseline",
            identifierColumn: "teilnehmer_id",
            cohortTag: null,
            columns: [],
          },
        ],
      },
    },
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
            columns: [],
          },
        ],
      },
    },
  ];
  const privacySafeRepresentations = [
    { uploadMetadataId: "upload-baseline", payload: { tables: [] } },
    { uploadMetadataId: "upload-workshop", payload: { tables: [] } },
  ];

  return {
    activityRepository: {
      listByProject: async () => activities,
    },
    uploadMetadataRepository: {
      listByActivityIds: async (activityIds: string[]) =>
        uploads.filter((upload) => activityIds.includes(upload.activityId)),
    },
    interpretationResultRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        results.filter((result) =>
          uploadMetadataIds.includes(result.uploadMetadataId),
        ),
    },
    datasetPreparationRepository: {
      findByInterpretationResultIds: async (
        interpretationResultIds: string[],
      ) =>
        preparations.filter((preparation) =>
          interpretationResultIds.includes(preparation.interpretationResultId),
        ),
    },
    privacySafeRepresentationRepository: {
      findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
        privacySafeRepresentations.filter((representation) =>
          uploadMetadataIds.includes(representation.uploadMetadataId),
        ),
    },
  } as unknown as OutcomeEvidencePairingEvidenceLoaderDependencies;
}

test("loadProjectEvidenceTablesForOutcomePairing only includes system activities", async () => {
  const tables = await loadProjectEvidenceTablesForOutcomePairing(
    buildDeps(),
    "project-1",
  );

  assert.deepEqual(
    tables.map((table) => table.tableName),
    ["baseline"],
  );
});

test("loadProjectEvidenceTablesForStoryPairing includes every activity, including an ordinary one", async () => {
  const tables = await loadProjectEvidenceTablesForStoryPairing(
    buildDeps(),
    "project-1",
  );

  assert.deepEqual(tables.map((table) => table.tableName).sort(), [
    "baseline",
    "workshop_feedback",
  ]);
});
