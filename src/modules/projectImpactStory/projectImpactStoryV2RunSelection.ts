import type { ActivityAnalysisRunV2PersistenceRecord } from "../interpretation/activityAnalysisRunV2Persistence.js";

interface ProjectImpactStoryV2RunSelectionActivity {
  id: string;
}

interface ProjectImpactStoryV2RunSelectionUpload {
  id: string;
  activityId: string;
}

export interface ProjectImpactStoryV2RunSelectionResult {
  latestRunsByActivityId: Map<string, ActivityAnalysisRunV2PersistenceRecord>;
  // Activity ids with no usable run: either no completed run exists yet, or
  // the newest completed run's evidence snapshot no longer matches the
  // activity's current uploads (new evidence was uploaded since that run,
  // or evidence was removed) — a completed run built from stale evidence is
  // not "the current analysis" even though it's the newest completed
  // document, same "stay on current state" invariant
  // currentActivityEvidenceLoader.ts enforces for the V2 pipeline itself.
  activitiesExcludedIds: string[];
}

export function selectCurrentV2RunsByActivity(
  activities: ProjectImpactStoryV2RunSelectionActivity[],
  runs: ActivityAnalysisRunV2PersistenceRecord[],
  uploads: ProjectImpactStoryV2RunSelectionUpload[],
): ProjectImpactStoryV2RunSelectionResult {
  const currentUploadIdsByActivityId = new Map<string, Set<string>>();
  for (const upload of uploads) {
    const existing =
      currentUploadIdsByActivityId.get(upload.activityId) ?? new Set<string>();
    existing.add(upload.id);
    currentUploadIdsByActivityId.set(upload.activityId, existing);
  }

  const latestCompletedRunByActivityId = new Map<
    string,
    ActivityAnalysisRunV2PersistenceRecord
  >();
  for (const run of runs) {
    if (run.status !== "completed") {
      continue;
    }
    const existing = latestCompletedRunByActivityId.get(run.activityId);
    if (!existing || run.createdAt.getTime() > existing.createdAt.getTime()) {
      latestCompletedRunByActivityId.set(run.activityId, run);
    }
  }

  const latestRunsByActivityId = new Map<
    string,
    ActivityAnalysisRunV2PersistenceRecord
  >();
  const activitiesExcludedIds: string[] = [];

  for (const activity of activities) {
    const run = latestCompletedRunByActivityId.get(activity.id);
    if (!run) {
      activitiesExcludedIds.push(activity.id);
      continue;
    }

    const currentUploadIds =
      currentUploadIdsByActivityId.get(activity.id) ?? new Set<string>();
    const runUploadIds = new Set(
      run.evidence.map((item) => item.uploadMetadataId),
    );
    const evidenceMatchesCurrentUploads =
      runUploadIds.size === currentUploadIds.size &&
      Array.from(runUploadIds).every((id) => currentUploadIds.has(id));

    if (!evidenceMatchesCurrentUploads) {
      activitiesExcludedIds.push(activity.id);
      continue;
    }

    latestRunsByActivityId.set(activity.id, run);
  }

  return { latestRunsByActivityId, activitiesExcludedIds };
}
