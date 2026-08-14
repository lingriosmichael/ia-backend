import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const qualitativeCodingReviewSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    privacySafeRepresentationId: { type: String, required: true, index: true },
    interpretationResultId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    findings: { type: Schema.Types.Mixed, required: true },
    decisions: { type: Schema.Types.Mixed, default: null },
    approvedById: { type: String, default: null },
    approvedAt: { type: Date, default: null },
  },
  {
    collection: "qualitative_coding_reviews",
    timestamps: true,
  },
);

export type QualitativeCodingReviewMongoDocument = InferSchemaType<
  typeof qualitativeCodingReviewSchema
>;
export type QualitativeCodingReviewMongoHydratedDocument =
  HydratedDocument<QualitativeCodingReviewMongoDocument>;
export const QualitativeCodingReviewMongoModel = createModel(
  "QualitativeCodingReview",
  qualitativeCodingReviewSchema,
);
