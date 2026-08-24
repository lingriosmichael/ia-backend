import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("activity_analysis_runs_v2");
}

const narrativeFieldFilter = {
  $or: [
    { renderedSummary: { $exists: true } },
    { recommendationText: { $exists: true } },
  ],
};

runMigrationScript({
  scriptLabel:
    "ActivityAnalystV2 narrative field (renderedSummary/recommendationText) removal",
  preview: async () => {
    const affectedCount =
      await getCollection().countDocuments(narrativeFieldFilter);
    console.log(
      `${affectedCount} activity_analysis_runs_v2 document(s) currently carry renderedSummary and/or recommendationText.`,
    );
  },
  apply: async () => {
    const result = await getCollection().updateMany(narrativeFieldFilter, {
      $unset: {
        renderedSummary: "",
        recommendationText: "",
      },
    });
    console.log(
      `Unset renderedSummary/recommendationText on ${result.modifiedCount} document(s).`,
    );
  },
});
