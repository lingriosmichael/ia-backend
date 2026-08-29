import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityAnalysisV2ToolExecutor } from "../interpretation/activityAnalysisV2ToolExecutor.js";
import type { CurrentActivityEvidenceLoader } from "../interpretation/currentActivityEvidenceLoader.js";
import type { OutcomeEvidencePairingEvidenceLoaderDependencies } from "../outcome/outcomeEvidencePairingEvidenceLoader.js";
import { buildProjectImpactStoryPairedStoryDeltaCatalog } from "./projectImpactStoryPairedStoryDeltaCatalog.js";

// This exploratory lane's paired-delta detection went through
// computeOutcomeEvidencePairingCandidates's declared pairing_group_key/
// pairing_group_role scan — removed in OUTCOME_EVIDENCE_MERGE_PLAN.md
// Phase 6 along with the rest of that declaration mechanism (it belonged
// to the outcome-evidence-pairing flow this plan replaces). Nothing
// populates those fields anymore, so this catalog can only ever return an
// empty list now — a known, accepted consequence documented in the plan's
// Phase 6 notes, not a bug. This test locks in that (still correct, not
// crashing) behavior rather than testing paired-delta detection that no
// longer exists.
function buildDeps(): OutcomeEvidencePairingEvidenceLoaderDependencies {
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
              },
              {
                name: "verstaendnis_nachher",
                epistemicRole: "validated_scale",
                minValue: 1,
                maxValue: 5,
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

function buildToolExecutor(): ActivityAnalysisV2ToolExecutor {
  return {
    execute: async () => {
      throw new Error(
        "should never be called — no paired_delta candidate can exist anymore",
      );
    },
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

test("returns an empty catalog — declared paired_delta detection no longer exists post-merge", async () => {
  const entries = await buildProjectImpactStoryPairedStoryDeltaCatalog(
    {
      outcomeEvidencePairingEvidenceLoaderDependencies: buildDeps(),
      currentActivityEvidenceLoader: buildEvidenceLoader(),
      activityAnalysisV2ToolExecutor: buildToolExecutor(),
      logger: NOOP_LOGGER,
    },
    "project-1",
    [{ id: "activity-workshop", name: "Workshop" }],
    [],
  );

  assert.deepEqual(entries, []);
});
