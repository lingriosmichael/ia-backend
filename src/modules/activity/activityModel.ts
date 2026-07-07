import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const activitySchema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    createdById: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    activityType: { type: String, default: null },
    owner: { type: String, default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    objectives: { type: String, default: null },
    successIndicators: { type: String, default: null },
    targetAudience: { type: String, default: null },
    additionalContext: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
  },
  {
    collection: "activities",
    timestamps: true,
  },
);

export type ActivityMongoDocument = InferSchemaType<typeof activitySchema>;
export type ActivityMongoHydratedDocument =
  HydratedDocument<ActivityMongoDocument>;
export const ActivityMongoModel = createModel("Activity", activitySchema);
