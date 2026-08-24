import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

interface ActivityAnalysisRunV2MigrationDocument {
  goalsSnapshot: { outcome?: string | null };
  assessment: { goalAssessments: Array<{ goalType: string }> } | null;
}

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection<ActivityAnalysisRunV2MigrationDocument>(
    "activity_analysis_runs_v2",
  );
}

const outcomeSnapshotFilter = { "goalsSnapshot.outcome": { $exists: true } };
const outcomeGoalAssessmentFilter = {
  "assessment.goalAssessments.goalType": "outcome",
};

runMigrationScript({
  scriptLabel: "ActivityAnalystV2 deprecated outcome-goal data removal",
  preview: async () => {
    const [snapshotCount, goalAssessmentCount] = await Promise.all([
      getCollection().countDocuments(outcomeSnapshotFilter),
      getCollection().countDocuments(outcomeGoalAssessmentFilter),
    ]);
    console.log(
      `${snapshotCount} run(s) carry goalsSnapshot.outcome; ${goalAssessmentCount} run(s) carry an "outcome" goal assessment.`,
    );
  },
  apply: async () => {
    const collection = getCollection();

    const unsetResult = await collection.updateMany(outcomeSnapshotFilter, {
      $unset: {
        "goalsSnapshot.outcome": "",
      },
    });

    const pullResult = await collection.updateMany(
      outcomeGoalAssessmentFilter,
      {
        $pull: {
          "assessment.goalAssessments": { goalType: "outcome" },
        },
      },
    );

    console.log(
      `goalsSnapshot.outcome unset on ${unsetResult.modifiedCount} run(s); ` +
        `outcome goal assessments pulled from ${pullResult.modifiedCount} run(s).`,
    );
  },
});
