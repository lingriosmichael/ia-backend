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

  await database.collection("memberships").updateMany(
    {},
    [
      {
        $set: {
          role: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$role", "owner"] },
                  then: "ORGANIZATION_ADMIN",
                },
                {
                  case: { $eq: ["$role", "member"] },
                  then: "PROJECT_MANAGER",
                },
              ],
              default: "$role",
            },
          },
        },
      },
    ],
  );

  await database.collection("organizations").updateMany(
    {},
    [
      {
        $set: {
          mission: { $ifNull: ["$mission", "$description"] },
          logoUrl: { $ifNull: ["$logoUrl", "$logoPath"] },
        },
      },
      {
        $unset: ["description", "logoPath"],
      },
    ],
  );

  await database.collection("projects").updateMany(
    {},
    [
      {
        $set: {
          ownerId: { $ifNull: ["$ownerId", "$createdById"] },
        },
      },
      {
        $unset: ["createdById"],
      },
    ],
  );

  await database.collection("activities").updateMany(
    {
      additionalContext: { $exists: false },
    },
    {
      $set: {
        additionalContext: null,
      },
    },
  );
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
    console.log("Organization role model migration completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
