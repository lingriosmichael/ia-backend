import mongoose from "mongoose";
import type { BackendConfig } from "../config/env.js";

let connectPromise: Promise<typeof mongoose> | null = null;

export async function connectMongoDatabase(config: BackendConfig) {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectPromise) {
    connectPromise = mongoose.connect(config.MONGODB_URI, {
      dbName: config.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 5000,
    });
  }

  return connectPromise;
}

export async function disconnectMongoDatabase() {
  connectPromise = null;

  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}
