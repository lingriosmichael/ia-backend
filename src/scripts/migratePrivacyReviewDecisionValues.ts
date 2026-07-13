import mongoose from "mongoose";
import { loadConfig } from "../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../shared/database/mongoose.js";

async function run() {
  const config = loadConfig();
  await connectMongoDatabase(config);

  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }

  const collection = database.collection("privacy_reviews");

  const legacyFilter = {
    "decisions.fieldDecisions": {
      $elemMatch: {
        decision: { $in: ["exclude", "continue_with_restriction"] },
      },
    },
  };

  const beforeCount = await collection.countDocuments(legacyFilter);
  console.log(
    `Found ${beforeCount} privacy review documents containing legacy decision values.`,
  );

  if (beforeCount === 0) {
    return;
  }

  const result = await collection.updateMany({}, [
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
    `Updated ${result.modifiedCount} privacy review documents to the new decision vocabulary.`,
  );
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
    console.log("Privacy review decision migration completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
