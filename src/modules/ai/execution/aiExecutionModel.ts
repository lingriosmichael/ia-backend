import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../../shared/database/createModel.js";

const aiExecutionSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, default: null, index: true },
    triggeredById: { type: String, required: true },
    jobType: {
      type: String,
      enum: ["semantic_ingestion", "manual_review", "export", "other"],
      required: true,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "cancelled"],
      default: "queued",
    },
    payload: { type: Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    collection: "ai_executions",
    timestamps: true,
  },
);

export type AIExecutionMongoDocument = InferSchemaType<typeof aiExecutionSchema>;
export type AIExecutionMongoHydratedDocument = HydratedDocument<AIExecutionMongoDocument>;
export const AIExecutionMongoModel = createModel("AIExecution", aiExecutionSchema);
