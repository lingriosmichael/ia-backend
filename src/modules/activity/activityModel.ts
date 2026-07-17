import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const activityAiKnowledgeInsightSchema = new Schema(
  {
    id: { type: String, required: true },
    sourceType: {
      type: String,
      enum: [
        "goal_alignment",
        "qualitative_finding",
        "indicator",
        "distribution_signal",
      ],
      required: true,
    },
    text: { type: String, required: true },
    isGoalRelevant: { type: Boolean, required: true },
    sourceUploadMetadataIds: { type: [String], default: [] },
  },
  {
    _id: false,
    id: false,
  },
);

const activityAiKnowledgeSnapshotSchema = new Schema(
  {
    generatedAt: { type: Date, required: true },
    summaryText: { type: String, default: "" },
    interpretedEvidenceCount: { type: Number, required: true },
    totalEvidenceCount: { type: Number, required: true },
    insights: { type: [activityAiKnowledgeInsightSchema], default: [] },
  },
  {
    _id: false,
    id: false,
  },
);

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
    aiKnowledgeSnapshot: {
      type: activityAiKnowledgeSnapshotSchema,
      default: null,
    },
    interpretationAcknowledgedAt: { type: Date, default: null },
    interpretationAcknowledgedById: { type: String, default: null },
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
