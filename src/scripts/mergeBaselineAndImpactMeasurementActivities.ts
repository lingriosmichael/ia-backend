import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

// OUTCOME_EVIDENCE_MERGE_PLAN.md §7/§9 Phase 5. Merges each project's
// separate "baseline" and "impact_measurement" system activities into one
// "outcome_evidence" activity ("Ausgangslage & Wirkungsdaten"), reusing the
// baseline activity's _id (minimizes reference rewrites vs. minting a new
// one) and rewriting every activityId-keyed collection's reference to the
// old impact_measurement activity onto that same id.
//
// Had to run before "baseline"/"impact_measurement" were removed from the
// ActivitySystemType enum (see plan §4.1/§7's own "run order matters" note)
// — that removal has since happened (Phase 6), so this script is now purely
// historical and can no longer be re-run against the current schema.
//
// Not automated by this script (plan §7 step 6, explicitly): converting a
// project's existing single_distribution links into real paired_delta links
// where they should have been all along. That was originally meant to be a
// human-reviewed step via the old mergeIntoPairedDelta action, but that
// action was retired outright in Phase 6 rather than carried over — see
// plan §5.1. The new recommendation flow is the only path for this now.

const MERGED_ACTIVITY_NAME = "Ausgangslage & Wirkungsdaten";
const MERGED_SYSTEM_TYPE = "outcome_evidence";

// Every activityId-keyed collection from plan §3 whose reference is a
// plain top-level `activityId` field with no other constraint on it —
// handled uniformly by one updateMany per collection. `outcome_evidence_links`
// is deliberately excluded: it has no top-level `activityId` on its
// paired_delta shape (activityIdBefore/activityIdAfter instead) and is
// handled separately below. `outcome_evidence_pairing_results` and
// `activity_evidence_linkage_results` are also excluded from this list —
// see CLEARED_PER_ACTIVITY_CACHE_COLLECTION below for why.
const SIMPLE_ACTIVITY_ID_COLLECTIONS = [
  "uploads",
  "privacy_reviews",
  "qualitative_coding_reviews",
  "privacy_safe_representations",
  "parsed_representations",
  "interpretation_results",
  "dataset_preparations",
  "activity_analysis_runs_v2",
  "ai_executions",
  "knowledge_indicators",
  "knowledge_entities",
] as const;

// activityEvidenceLinkageResultModel.ts declares `activityId` as `unique:
// true` — exactly one reconciliation-cache document per activity, the same
// shape as outcome_evidence_pairing_results's `projectId: unique: true`
// (plan §7 step 4 already treats that one as cache-to-clear, not
// cache-to-rewrite, for exactly this reason). A plain field rewrite here
// would try to collide the impact_measurement activity's document onto
// the baseline activity's *already-existing* one and fail a unique-index
// write (confirmed against real data 2026-08-27 — this was a real bug in
// the first version of this script, not a hypothetical). Cleared for
// *both* the baseline and impact_measurement activity ids: it is a
// reconciliation cache that regenerates safely from current evidence, and
// neither side's stale cache correctly reflects the merged activity's
// full evidence set anyway.
const CLEARED_PER_ACTIVITY_CACHE_COLLECTION =
  "activity_evidence_linkage_results";

interface ActivityPair {
  projectId: string;
  baselineActivityId: string;
  impactMeasurementActivityId: string;
}

interface ActivityDocument {
  _id: string;
  projectId: string;
  systemType: string;
}

function getDatabase(): mongoose.mongo.Db {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database;
}

// activityModel.ts declares `_id: { type: String, ... }` — every id in this
// codebase is a createDocumentId() string (see webapp CLAUDE.md), never a
// Mongo ObjectId. The raw driver's default typing assumes ObjectId for any
// collection accessed without a generic, so every raw `activities` access
// that filters or sets by `_id` needs this explicit document type instead.
function getActivitiesCollection(): mongoose.mongo.Collection<ActivityDocument> {
  return getDatabase().collection<ActivityDocument>("activities");
}

/**
 * A project only qualifies for this migration once it has exactly one
 * "baseline" and one "impact_measurement" activity — the unique
 * {projectId, systemType} index (activityModel.ts) already guarantees at
 * most one of each per project, so no further de-duplication is needed
 * here. A project with only one of the two is a pre-existing anomaly
 * (never expected under ensureProjectSystemActivities, which always
 * creates both together) and is reported, not silently skipped or
 * guessed at.
 */
async function findActivityPairs(): Promise<{
  pairs: ActivityPair[];
  incompleteProjectIds: string[];
}> {
  const activities = await getActivitiesCollection()
    .find(
      { systemType: { $in: ["baseline", "impact_measurement"] } },
      { projection: { _id: 1, projectId: 1, systemType: 1 } },
    )
    .toArray();

  const byProject = new Map<
    string,
    { baseline?: string; impactMeasurement?: string }
  >();
  for (const activity of activities) {
    const entry = byProject.get(activity.projectId) ?? {};
    if (activity.systemType === "baseline") {
      entry.baseline = activity._id;
    } else if (activity.systemType === "impact_measurement") {
      entry.impactMeasurement = activity._id;
    }
    byProject.set(activity.projectId, entry);
  }

  const pairs: ActivityPair[] = [];
  const incompleteProjectIds: string[] = [];
  for (const [projectId, entry] of byProject) {
    if (entry.baseline && entry.impactMeasurement) {
      pairs.push({
        projectId,
        baselineActivityId: entry.baseline,
        impactMeasurementActivityId: entry.impactMeasurement,
      });
    } else {
      incompleteProjectIds.push(projectId);
    }
  }

  return { pairs, incompleteProjectIds };
}

interface ProjectMigrationPlan extends ActivityPair {
  collectionCounts: Array<{ collectionName: string; count: number }>;
  pairedDeltaLinkCount: number;
  singleDistributionLinkCount: number;
  hasPairingResultCache: boolean;
  linkageResultCacheCountToClear: number;
}

async function buildMigrationPlan(
  pair: ActivityPair,
): Promise<ProjectMigrationPlan> {
  const db = getDatabase();

  const collectionCounts = await Promise.all(
    SIMPLE_ACTIVITY_ID_COLLECTIONS.map(async (collectionName) => ({
      collectionName,
      count: await db
        .collection(collectionName)
        .countDocuments({ activityId: pair.impactMeasurementActivityId }),
    })),
  );

  const pairedDeltaLinkCount = await db
    .collection("outcome_evidence_links")
    .countDocuments({
      $or: [
        { activityIdBefore: pair.impactMeasurementActivityId },
        { activityIdAfter: pair.impactMeasurementActivityId },
      ],
    });
  const singleDistributionLinkCount = await db
    .collection("outcome_evidence_links")
    .countDocuments({ activityId: pair.impactMeasurementActivityId });
  const hasPairingResultCache =
    (await db
      .collection("outcome_evidence_pairing_results")
      .countDocuments({ projectId: pair.projectId })) > 0;
  const linkageResultCacheCountToClear = await db
    .collection(CLEARED_PER_ACTIVITY_CACHE_COLLECTION)
    .countDocuments({
      activityId: {
        $in: [pair.baselineActivityId, pair.impactMeasurementActivityId],
      },
    });

  return {
    ...pair,
    collectionCounts,
    pairedDeltaLinkCount,
    singleDistributionLinkCount,
    hasPairingResultCache,
    linkageResultCacheCountToClear,
  };
}

function logMigrationPlan(plan: ProjectMigrationPlan): void {
  console.log(`\nProject ${plan.projectId}:`);
  console.log(
    `  baseline activity ${plan.baselineActivityId} -> reused as the merged activity ` +
      `(renamed "${MERGED_ACTIVITY_NAME}", systemType "${MERGED_SYSTEM_TYPE}")`,
  );
  console.log(
    `  impact_measurement activity ${plan.impactMeasurementActivityId} -> ` +
      "deleted once its references are rewritten",
  );

  const nonEmptyCollectionCounts = plan.collectionCounts.filter(
    ({ count }) => count > 0,
  );
  if (nonEmptyCollectionCounts.length === 0) {
    console.log("    no activityId-keyed documents to rewrite");
  }
  for (const { collectionName, count } of nonEmptyCollectionCounts) {
    console.log(`    ${collectionName}: ${count} document(s) rewritten`);
  }
  if (plan.pairedDeltaLinkCount > 0) {
    console.log(
      `    outcome_evidence_links (paired_delta activityIdBefore/After): ${plan.pairedDeltaLinkCount} rewritten`,
    );
  }
  if (plan.singleDistributionLinkCount > 0) {
    console.log(
      `    outcome_evidence_links (single_distribution activityId): ${plan.singleDistributionLinkCount} rewritten`,
    );
  }
  console.log(
    `    outcome_evidence_pairing_results cache: ${
      plan.hasPairingResultCache ? "cleared" : "none to clear"
    }`,
  );
  console.log(
    `    ${CLEARED_PER_ACTIVITY_CACHE_COLLECTION} cache: ${
      plan.linkageResultCacheCountToClear > 0
        ? `${plan.linkageResultCacheCountToClear} document(s) cleared`
        : "none to clear"
    }`,
  );
}

async function applyMigrationForProject(pair: ActivityPair): Promise<void> {
  const db = getDatabase();

  // Step 1: rename + retype the baseline activity in place. Its _id
  // becomes the merged activity's id — no other document needs its
  // reference to the baseline activity rewritten.
  await getActivitiesCollection().updateOne(
    { _id: pair.baselineActivityId },
    {
      $set: { name: MERGED_ACTIVITY_NAME, systemType: MERGED_SYSTEM_TYPE },
    },
  );

  // Step 2: rewrite every activityId-keyed collection's reference to the
  // old impact_measurement activity onto the (now merged) baseline id.
  for (const collectionName of SIMPLE_ACTIVITY_ID_COLLECTIONS) {
    await db
      .collection(collectionName)
      .updateMany(
        { activityId: pair.impactMeasurementActivityId },
        { $set: { activityId: pair.baselineActivityId } },
      );
  }
  await db
    .collection("outcome_evidence_links")
    .updateMany(
      { activityIdBefore: pair.impactMeasurementActivityId },
      { $set: { activityIdBefore: pair.baselineActivityId } },
    );
  await db
    .collection("outcome_evidence_links")
    .updateMany(
      { activityIdAfter: pair.impactMeasurementActivityId },
      { $set: { activityIdAfter: pair.baselineActivityId } },
    );
  await db
    .collection("outcome_evidence_links")
    .updateMany(
      { activityId: pair.impactMeasurementActivityId },
      { $set: { activityId: pair.baselineActivityId } },
    );

  // Step 3: delete the now-empty impact_measurement activity document.
  await getActivitiesCollection().deleteOne({
    _id: pair.impactMeasurementActivityId,
  });

  // Step 4: clear the project's outcome_evidence_pairing_results cache —
  // a reconciliation cache, not a source of truth, that references the
  // old activity/candidate-id scheme in ways not worth surgically
  // rewriting (plan §7 step 4).
  await db
    .collection("outcome_evidence_pairing_results")
    .deleteMany({ projectId: pair.projectId });

  // Step 5: clear the per-activity linkage-result cache for *both* old
  // activity ids — see CLEARED_PER_ACTIVITY_CACHE_COLLECTION's doc comment
  // for why this can't be a plain field rewrite like step 2's collections.
  await db.collection(CLEARED_PER_ACTIVITY_CACHE_COLLECTION).deleteMany({
    activityId: {
      $in: [pair.baselineActivityId, pair.impactMeasurementActivityId],
    },
  });
}

runMigrationScript({
  scriptLabel:
    "Merge baseline + impact_measurement activities into one outcome_evidence activity",
  preview: async () => {
    const { pairs, incompleteProjectIds } = await findActivityPairs();

    if (incompleteProjectIds.length > 0) {
      console.warn(
        `${incompleteProjectIds.length} project(s) have only one of baseline/impact_measurement ` +
          `and will be SKIPPED (unexpected — ensureProjectSystemActivities always creates both together): ` +
          incompleteProjectIds.join(", "),
      );
    }

    if (pairs.length === 0) {
      console.log(
        "No projects have both a baseline and an impact_measurement activity — nothing to migrate.",
      );
      return;
    }

    console.log(`${pairs.length} project(s) will be migrated:`);
    for (const pair of pairs) {
      logMigrationPlan(await buildMigrationPlan(pair));
    }
    console.log(
      "\nNot performed by this script — must be reconciled manually afterward, " +
        "per plan §7 step 6: converting any existing single_distribution links into " +
        "real paired_delta links via the new recommendation flow (the old " +
        "mergeIntoPairedDelta action was retired in Phase 6, see plan §5.1).",
    );
  },
  apply: async () => {
    const { pairs, incompleteProjectIds } = await findActivityPairs();

    if (incompleteProjectIds.length > 0) {
      console.warn(
        `${incompleteProjectIds.length} project(s) have only one of baseline/impact_measurement ` +
          `and were SKIPPED: ${incompleteProjectIds.join(", ")}`,
      );
    }

    if (pairs.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    for (const pair of pairs) {
      await applyMigrationForProject(pair);
      console.log(`Migrated project ${pair.projectId}.`);
    }
    console.log(`${pairs.length} project(s) migrated.`);
  },
});
