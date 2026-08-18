interface StalenessStorySnapshot {
  sourceSnapshot: Array<{
    activityId: string;
    activityAnalysisRunId: string;
  }>;
}

interface StalenessCurrentActivity {
  id: string;
}

interface StalenessCurrentActivityAnalysisRun {
  id: string;
  activityId: string;
  status: string;
  createdAt: Date;
}

// Computed on read, never persisted — a persisted `isStale` flag would
// itself go stale the moment new evidence lands. Stale means either the
// project's activity set changed, or the latest *completed* V2 run for some
// activity is a different document than the one this story was built from
// (a new document id, since V2 runs are append-only — a rerun creates a new
// document rather than mutating the old one).
export function computeProjectImpactStoryStaleness(
  story: StalenessStorySnapshot,
  currentActivities: StalenessCurrentActivity[],
  currentActivityAnalysisRuns: StalenessCurrentActivityAnalysisRun[],
): { isStale: boolean } {
  const currentActivityIds = new Set(
    currentActivities.map((activity) => activity.id),
  );
  const snapshotActivityIds = new Set(
    story.sourceSnapshot.map((item) => item.activityId),
  );

  if (currentActivityIds.size !== snapshotActivityIds.size) {
    return { isStale: true };
  }
  for (const activityId of currentActivityIds) {
    if (!snapshotActivityIds.has(activityId)) {
      return { isStale: true };
    }
  }

  const latestCompletedRunByActivityId = new Map<
    string,
    StalenessCurrentActivityAnalysisRun
  >();
  for (const run of currentActivityAnalysisRuns) {
    if (run.status !== "completed" || !currentActivityIds.has(run.activityId)) {
      continue;
    }
    const existing = latestCompletedRunByActivityId.get(run.activityId);
    if (!existing || run.createdAt.getTime() > existing.createdAt.getTime()) {
      latestCompletedRunByActivityId.set(run.activityId, run);
    }
  }

  const currentRunIds = new Set(
    Array.from(latestCompletedRunByActivityId.values()).map((run) => run.id),
  );
  const snapshotRunIds = new Set(
    story.sourceSnapshot.map((item) => item.activityAnalysisRunId),
  );

  if (currentRunIds.size !== snapshotRunIds.size) {
    return { isStale: true };
  }
  for (const runId of currentRunIds) {
    if (!snapshotRunIds.has(runId)) {
      return { isStale: true };
    }
  }

  return { isStale: false };
}
