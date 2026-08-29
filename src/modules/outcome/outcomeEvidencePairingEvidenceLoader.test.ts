import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProjectEvidenceTablesForStoryPairing,
  type OutcomeEvidencePairingEvidenceLoaderDependencies,
} from "./outcomeEvidencePairingEvidenceLoader.js";

// The system-activity-scoped variant of this loader
// (loadProjectEvidenceTablesForOutcomePairing) was removed in
// OUTCOME_EVIDENCE_MERGE_PLAN.md Phase 6 — outcome-evidence pairing now
// loads via outcomeEvidenceCandidateCatalogBuilder.ts's single-activity
// loader instead. loadProjectEvidenceTablesForStoryPairing survives solely
// for the exploratory paired-story-delta chart lane
// (projectImpactStoryPairedStoryDeltaCatalog.ts), which needs every
// activity in the project, not just system ones.
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

test("computes columnDistinctValueCounts by scanning the privacy-safe representation's rows once, alongside hasDuplicateIdentifierValues", async () => {
  const deps = {
    activityRepository: {
      listByProject: async () => [
        { id: "activity-workshop", systemType: null },
      ],
    },
    uploadMetadataRepository: {
      listByActivityIds: async () => [
        { id: "upload-workshop", activityId: "activity-workshop" },
      ],
    },
    interpretationResultRepository: {
      findLatestByUploadMetadataIds: async () => [
        { id: "result-workshop", uploadMetadataId: "upload-workshop" },
      ],
    },
    datasetPreparationRepository: {
      findByInterpretationResultIds: async () => [
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
                  { name: "teilnehmer_id" },
                  { name: "kontakt_haeufigkeit" },
                  { name: "kontakte_anzahl" },
                ],
              },
            ],
          },
        },
      ],
    },
    privacySafeRepresentationRepository: {
      findLatestByUploadMetadataIds: async () => [
        {
          uploadMetadataId: "upload-workshop",
          payload: {
            tables: [
              {
                name: "workshop_feedback",
                rows: [
                  {
                    teilnehmer_id: "t1",
                    kontakt_haeufigkeit: "3",
                    kontakte_anzahl: "5",
                  },
                  {
                    teilnehmer_id: "t2",
                    kontakt_haeufigkeit: "3",
                    kontakte_anzahl: "12",
                  },
                  {
                    teilnehmer_id: "t1",
                    kontakt_haeufigkeit: "4",
                    kontakte_anzahl: "1",
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  } as unknown as OutcomeEvidencePairingEvidenceLoaderDependencies;

  const [table] = await loadProjectEvidenceTablesForStoryPairing(
    deps,
    "project-1",
  );

  assert.equal(table?.hasDuplicateIdentifierValues, true);
  assert.deepEqual(table?.columnDistinctValueCounts, {
    teilnehmer_id: 2,
    kontakt_haeufigkeit: 2,
    kontakte_anzahl: 3,
  });
});
