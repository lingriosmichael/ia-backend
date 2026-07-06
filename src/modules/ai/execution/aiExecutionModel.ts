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
      enum: [
        "evidence_processing",
        "dataset_interpretation",
        "dataset_review",
        "metrics_generation",
        "dashboard_generation",
        "insight_generation",
        "report_generation",
        "chat",
        "other",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "queued",
        "processing",
        "awaiting_privacy_review",
        "transforming",
        "completed",
        "failed",
        "cancelled",
      ],
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

export type AIExecutionMongoDocument = InferSchemaType<
  typeof aiExecutionSchema
>;
export type AIExecutionMongoHydratedDocument =
  HydratedDocument<AIExecutionMongoDocument>;
export const ProcessingJobMongoModel = createModel(
  "ProcessingJob",
  aiExecutionSchema,
);
export const AIExecutionMongoModel = ProcessingJobMongoModel;
