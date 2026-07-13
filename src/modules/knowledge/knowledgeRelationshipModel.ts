import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { knowledgeRelationshipTypeValues } from "../../shared/contracts.js";

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

const knowledgeRelationshipSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    projectKnowledgeModelId: { type: String, required: true, index: true },
    fromEntityId: { type: String, required: true, index: true },
    toEntityId: { type: String, required: true, index: true },
    relationshipType: {
      type: String,
      enum: [...knowledgeRelationshipTypeValues],
      required: true,
    },
    confidence: { type: Number, required: true },
    sourceInstances: { type: [knowledgeSourceInstanceSchema], default: [] },
  },
  {
    collection: "knowledge_relationships",
    timestamps: true,
  },
);

export type KnowledgeRelationshipMongoDocument = InferSchemaType<
  typeof knowledgeRelationshipSchema
>;
export type KnowledgeRelationshipMongoHydratedDocument =
  HydratedDocument<KnowledgeRelationshipMongoDocument>;
export const KnowledgeRelationshipMongoModel = createModel(
  "KnowledgeRelationship",
  knowledgeRelationshipSchema,
);
