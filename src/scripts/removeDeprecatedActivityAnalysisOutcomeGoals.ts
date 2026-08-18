import mongoose from "mongoose";
import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";

interface ActivityAnalysisRunV2MigrationDocument {
  goalsSnapshot: { outcome?: string | null };
  assessment: { goalAssessments: Array<{ goalType: string }> } | null;
}

async function run() {
  const config = loadConfig();
  await connectMongoDatabase(config);

  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }

  const collection =
    database.collection<ActivityAnalysisRunV2MigrationDocument>(
      "activity_analysis_runs_v2",
    );

  const unsetResult = await collection.updateMany(
    {},
    {
      $unset: {
        "goalsSnapshot.outcome": "",
      },
    },
  );

  const pullResult = await collection.updateMany(
    { "assessment.goalAssessments.goalType": "outcome" },
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
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
    console.log(
      "ActivityAnalystV2 deprecated outcome-goal data removal completed.",
    );
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
