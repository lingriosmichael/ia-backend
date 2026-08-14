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
        "linkage_contradiction",
        "linkage_coverage_issue",
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

const activityAnalysisV2ClarificationAnswerSchema = new Schema(
  {
    questionId: { type: String, required: true },
    goalId: { type: String, default: null },
    prompt: { type: String, required: true },
    kind: { type: String, required: true },
    questionDomain: { type: String, required: true },
    options: { type: [String], default: null },
    recommendedOption: { type: String, default: null },
    recommendedConfidence: { type: Number, default: null },
    isBlocking: { type: Boolean, required: true },
    questionCode: { type: String, default: null },
    targetTableName: { type: String, default: null },
    targetColumnName: { type: String, default: null },
    answeredValue: { type: String, required: true },
    answeredById: { type: String, required: true },
    answeredAt: { type: Date, required: true },
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
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    targetAudience: { type: String, default: null },
    objectives: { type: String, default: null },
    output: { type: String, default: null },
    outcome: { type: String, default: null },
    concernTaggingInstruction: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
    aiKnowledgeSnapshot: {
      type: activityAiKnowledgeSnapshotSchema,
      default: null,
    },
    activityAnalysisV2ClarificationAnswers: {
      type: [activityAnalysisV2ClarificationAnswerSchema],
      default: [],
    },
    interpretationAcknowledgedAt: { type: Date, default: null },
    interpretationAcknowledgedById: { type: String, default: null },
    llmTokenLedger: {
      totalPromptTokensLifetime: { type: Number, default: 0 },
      totalCompletionTokensLifetime: { type: Number, default: 0 },
      totalTokensLifetime: { type: Number, default: 0 },
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
