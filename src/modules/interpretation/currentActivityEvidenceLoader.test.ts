import assert from "node:assert/strict";
import test from "node:test";
import { CurrentActivityEvidenceLoader } from "./currentActivityEvidenceLoader.js";
import type { UploadMetadataRepository } from "../upload/uploadMetadataRepository.js";
import type { PrivacySafeRepresentationRepository } from "../processing/privacySafeRepresentationRepository.js";
import type { QualitativeCodingReviewRepository } from "../processing/qualitativeCodingReviewRepository.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("load() batches the qualitative-coding-review lookup instead of querying once per upload", async () => {
  // Regression test: findByUploadMetadataId used to be called once per
  // upload inside a loop — for an N-upload activity, this gate (which runs
  // twice per POST/PATCH by design) cost up to ~3N redundant Mongo round
  // trips from this lookup alone. See findByUploadMetadataIds below.
  const uploads = [
    { id: "upload-1", organizationId: "org-1", projectId: "project-1" },
    { id: "upload-2", organizationId: "org-1", projectId: "project-1" },
    { id: "upload-3", organizationId: "org-1", projectId: "project-1" },
  ].map((upload) => ({
    ...upload,
    logicalEvidenceId: `evidence-${upload.id}`,
    versionNumber: 1,
    originalFileName: `${upload.id}.csv`,
    createdAt: NOW,
  }));

  const uploadMetadataRepository = {
    listByActivityIds: async () => uploads,
  } as unknown as UploadMetadataRepository;

  const privacySafeRepresentationRepository = {
    findLatestByUploadMetadataIds: async (uploadMetadataIds: string[]) =>
      uploadMetadataIds.map((uploadMetadataId) => ({
        id: `psr-${uploadMetadataId}`,
        uploadMetadataId,
        payload: { metadata: { evidenceModality: "structured_quantitative" } },
      })),
  } as unknown as PrivacySafeRepresentationRepository;

  let findByUploadMetadataIdCallCount = 0;
  let findByUploadMetadataIdsCallCount = 0;
  const qualitativeCodingReviewRepository = {
    findByUploadMetadataId: async () => {
      findByUploadMetadataIdCallCount += 1;
      return null;
    },
    findByUploadMetadataIds: async (uploadMetadataIds: string[]) => {
      findByUploadMetadataIdsCallCount += 1;
      assert.deepEqual(uploadMetadataIds, ["upload-1", "upload-2", "upload-3"]);
      return [];
    },
  } as unknown as QualitativeCodingReviewRepository;

  const loader = new CurrentActivityEvidenceLoader(
    uploadMetadataRepository,
    privacySafeRepresentationRepository,
    qualitativeCodingReviewRepository,
  );

  const snapshot = await loader.load("activity-1");

  assert.equal(snapshot.evidence.length, 3);
  assert.equal(findByUploadMetadataIdCallCount, 0);
  assert.equal(findByUploadMetadataIdsCallCount, 1);
});
