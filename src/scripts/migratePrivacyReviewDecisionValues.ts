import mongoose from "mongoose";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("privacy_reviews");
}

const legacyFilter = {
  "decisions.fieldDecisions": {
    $elemMatch: {
      decision: { $in: ["exclude", "continue_with_restriction"] },
    },
  },
};

runMigrationScript({
  scriptLabel: "Privacy review decision migration",
  preview: async () => {
    const affectedCount = await getCollection().countDocuments(legacyFilter);
    console.log(
      `Found ${affectedCount} privacy review document(s) containing legacy decision values.`,
    );
  },
  apply: async () => {
    const result = await getCollection().updateMany({}, [
      {
        $set: {
          "decisions.fieldDecisions": {
            $map: {
              input: { $ifNull: ["$decisions.fieldDecisions", []] },
              as: "fieldDecision",
              in: {
                $mergeObjects: [
                  "$$fieldDecision",
                  {
                    decision: {
                      $switch: {
                        branches: [
                          {
                            case: {
                              $eq: ["$$fieldDecision.decision", "exclude"],
                            },
                            then: "rejected",
                          },
                          {
                            case: {
                              $eq: [
                                "$$fieldDecision.decision",
                                "continue_with_restriction",
                              ],
                            },
                            then: "approved",
                          },
                        ],
                        default: "$$fieldDecision.decision",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    console.log(
      `Updated ${result.modifiedCount} privacy review document(s) to the new decision vocabulary.`,
    );
  },
});
