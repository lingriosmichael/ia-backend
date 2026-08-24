import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("activities");
}

const outcomeFieldFilter = { outcome: { $exists: true } };

runMigrationScript({
  scriptLabel: "Activity outcome field removal",
  preview: async () => {
    const affectedCount =
      await getCollection().countDocuments(outcomeFieldFilter);
    console.log(
      `${affectedCount} activity document(s) currently carry the deprecated outcome field.`,
    );
  },
  apply: async () => {
    const result = await getCollection().updateMany(outcomeFieldFilter, {
      $unset: {
        outcome: "",
      },
    });
    console.log(
      `Unset outcome on ${result.modifiedCount} activity document(s).`,
    );
  },
});
