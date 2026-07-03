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

  await database.collection("organizations").updateMany({}, [
    {
      $set: {
        mission: { $ifNull: ["$mission", "$description"] },
        logoUrl: { $ifNull: ["$logoUrl", "$logoPath"] },
      },
    },
    {
      $unset: ["description", "logoPath", "slug", "updatedAt"],
    },
  ]);
}

run()
  .then(async () => {
    await disconnectMongoDatabase();
    console.log("Organization shape cleanup completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectMongoDatabase();
    process.exit(1);
  });
