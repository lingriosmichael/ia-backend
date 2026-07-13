import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { knowledgeEntityTypeValues } from "../../shared/contracts.js";

const knowledgeSourceInstanceSchema = new Schema(
  {
    uploadMetadataId: { type: String, required: true },
    interpretationResultId: { type: String, required: true },
    activityId: { type: String, required: true },
    activityType: { type: String, default: null },
    sourceReference: { type: String, required: true },
    addedAt: { type: Date, required: true },
  },
  { _id: false },
);

const knowledgeEntitySchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    projectKnowledgeModelId: { type: String, required: true, index: true },
    entityType: {
      type: String,
      enum: [...knowledgeEntityTypeValues],
      required: true,
      index: true,
    },
    canonicalLabel: { type: String, required: true },
    description: { type: String, default: "" },
    attributes: { type: Schema.Types.Mixed, default: {} },
    sourceInstances: { type: [knowledgeSourceInstanceSchema], default: [] },
  },
  {
    collection: "knowledge_entities",
    timestamps: true,
  },
);

export type KnowledgeEntityMongoDocument = InferSchemaType<
  typeof knowledgeEntitySchema
>;
export type KnowledgeEntityMongoHydratedDocument =
  HydratedDocument<KnowledgeEntityMongoDocument>;
export const KnowledgeEntityMongoModel = createModel(
  "KnowledgeEntity",
  knowledgeEntitySchema,
);
