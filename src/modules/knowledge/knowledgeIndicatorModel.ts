import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { knowledgeIndicatorDeduplicationConfidenceValues } from "../../shared/contracts.js";

const knowledgeIndicatorSourceEvidenceSchema = new Schema(
  {
    uploadMetadataId: { type: String, required: true },
    interpretationResultId: { type: String, required: true },
    sourceReference: { type: String, required: true },
  },
  { _id: false },
);

const knowledgeIndicatorSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    projectKnowledgeModelId: { type: String, required: true, index: true },
    knowledgeEntityId: { type: String, required: true, index: true },
    value: { type: Number, required: true },
    unit: { type: String, default: null },
    activityId: { type: String, required: true, index: true },
    participantId: { type: String, default: null },
    sourceEvidence: {
      type: knowledgeIndicatorSourceEvidenceSchema,
      required: true,
    },
    confidence: { type: Number, required: true },
    // Only meaningful for count_distinct recombined across more than one
    // source instance — see KnowledgeIndicatorDeduplicationConfidence in
    // shared/contracts.ts and "Merging computed values" in
    // "Phase 4 — Project Knowledge Model.md".
    deduplicationConfidence: {
      type: String,
      enum: [...knowledgeIndicatorDeduplicationConfidenceValues],
      required: true,
    },
  },
  {
    collection: "knowledge_indicators",
    timestamps: true,
  },
);

export type KnowledgeIndicatorMongoDocument = InferSchemaType<
  typeof knowledgeIndicatorSchema
>;
export type KnowledgeIndicatorMongoHydratedDocument =
  HydratedDocument<KnowledgeIndicatorMongoDocument>;
export const KnowledgeIndicatorMongoModel = createModel(
  "KnowledgeIndicator",
  knowledgeIndicatorSchema,
);
