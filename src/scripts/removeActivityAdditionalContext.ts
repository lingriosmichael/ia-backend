import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("activities");
}

const additionalContextFilter = { additionalContext: { $exists: true } };

runMigrationScript({
  scriptLabel: "Activity additionalContext removal",
  preview: async () => {
    const affectedCount = await getCollection().countDocuments(
      additionalContextFilter,
    );
    console.log(
      `${affectedCount} activity document(s) currently carry additionalContext.`,
    );
  },
  apply: async () => {
    const result = await getCollection().updateMany(additionalContextFilter, {
      $unset: {
        additionalContext: "",
      },
    });
    console.log(
      `Unset additionalContext on ${result.modifiedCount} activity document(s).`,
    );
  },
});
