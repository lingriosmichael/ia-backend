import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const uploadMetadataSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadedById: { type: String, required: true },
    logicalEvidenceId: { type: String, required: true, index: true },
    versionNumber: { type: Number, required: true, min: 1 },
    replacesUploadMetadataId: { type: String, default: null, index: true },
    supersededAt: { type: Date, default: null, index: true },
    originalFileName: { type: String, required: true, trim: true },
    contentType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    storageKey: { type: String, default: null },
    originalFileDeletedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["pending", "uploaded", "archived"],
      default: "pending",
    },
  },
  {
    collection: "uploads",
    timestamps: true,
  },
);

uploadMetadataSchema.index({ logicalEvidenceId: 1, versionNumber: -1 });

export type UploadMetadataMongoDocument = InferSchemaType<
  typeof uploadMetadataSchema
>;
export type UploadMetadataMongoHydratedDocument =
  HydratedDocument<UploadMetadataMongoDocument>;
export const UploadMetadataMongoModel = createModel(
  "UploadMetadata",
  uploadMetadataSchema,
);
