import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../../shared/database/createModel.js";

const resultRecordSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, default: null, index: true },
    processingJobId: { type: String, default: null, index: true },
    createdById: { type: String, required: true },
    resultType: {
      type: String,
      enum: [
        "semantic_summary",
        "activity_snapshot",
        "project_snapshot",
        "other",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "available", "archived"],
      default: "pending",
    },
    payload: { type: Schema.Types.Mixed, default: null },
  },
  {
    // Physical collection name kept as-is (renaming would require a data
    // migration on any environment with existing documents).
    collection: "ai_artifacts",
    timestamps: true,
  },
);

export type ResultRecordMongoDocument = InferSchemaType<
  typeof resultRecordSchema
>;
export type ResultRecordMongoHydratedDocument =
  HydratedDocument<ResultRecordMongoDocument>;
export const ResultRecordMongoModel = createModel(
  "ResultRecord",
  resultRecordSchema,
);
