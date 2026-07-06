import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const parsedRepresentationSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    processingJobId: { type: String, required: true, index: true },
    fileType: {
      type: String,
      enum: ["spreadsheet", "document", "unknown"],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "parsed_representations",
    timestamps: true,
  },
);

export type ParsedRepresentationMongoDocument = InferSchemaType<
  typeof parsedRepresentationSchema
>;
export type ParsedRepresentationMongoHydratedDocument =
  HydratedDocument<ParsedRepresentationMongoDocument>;
export const ParsedRepresentationMongoModel = createModel(
  "ParsedRepresentation",
  parsedRepresentationSchema,
);
