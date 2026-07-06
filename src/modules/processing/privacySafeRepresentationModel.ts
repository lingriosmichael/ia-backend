import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const privacySafeRepresentationSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    processingJobId: { type: String, required: true, index: true },
    privacyReviewId: { type: String, required: true, index: true },
    parsedRepresentationId: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "privacy_safe_representations",
    timestamps: true,
  },
);

export type PrivacySafeRepresentationMongoDocument = InferSchemaType<
  typeof privacySafeRepresentationSchema
>;
export type PrivacySafeRepresentationMongoHydratedDocument =
  HydratedDocument<PrivacySafeRepresentationMongoDocument>;
export const PrivacySafeRepresentationMongoModel = createModel(
  "PrivacySafeRepresentation",
  privacySafeRepresentationSchema,
);
