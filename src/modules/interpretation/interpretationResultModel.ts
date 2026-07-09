import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  indicatorRelevanceStageValues,
  interpretationIndicatorStatusValues,
  interpretationQuestionKindValues,
  interpretationQuestionStatusValues,
  interpretationWarningSeverityValues,
} from "../../shared/contracts.js";

const interpretationEntitySchema = new Schema({
  _id: { type: String, default: createDocumentId },
  originalField: { type: String, required: true },
  aiMeaning: { type: String, required: true },
  entityType: { type: String, required: true },
  confidence: { type: Number, required: true },
  reason: { type: String, required: true },
  sampleValues: { type: [String], default: [] },
});

const interpretationIndicatorSchema = new Schema({
  _id: { type: String, default: createDocumentId },
  name: { type: String, required: true },
  description: { type: String, required: true },
  confidence: { type: Number, required: true },
  reason: { type: String, required: true },
  relatedEntityIds: { type: [String], default: [] },
  relevanceStage: {
    type: String,
    enum: [...indicatorRelevanceStageValues],
    default: null,
  },
  status: {
    type: String,
    enum: [...interpretationIndicatorStatusValues],
    default: "kept",
  },
});

const interpretationRelationshipSchema = new Schema({
  _id: { type: String, default: createDocumentId },
  description: { type: String, required: true },
  involvedEntityIds: { type: [String], default: [] },
  confidence: { type: Number, required: true },
});

const interpretationQuestionSchema = new Schema({
  _id: { type: String, default: createDocumentId },
  prompt: { type: String, required: true },
  kind: {
    type: String,
    enum: [...interpretationQuestionKindValues],
    required: true,
  },
  options: { type: [String], default: null },
  status: {
    type: String,
    enum: [...interpretationQuestionStatusValues],
    default: "pending",
  },
  answeredValue: { type: String, default: null },
  answeredById: { type: String, default: null },
  answeredAt: { type: Date, default: null },
});

const interpretationWarningSchema = new Schema({
  _id: { type: String, default: createDocumentId },
  message: { type: String, required: true },
  severity: {
    type: String,
    enum: [...interpretationWarningSeverityValues],
    required: true,
  },
});

const interpretationGoalCoverageSchema = new Schema({
  _id: { type: String, default: createDocumentId },
  goalSummary: { type: String, required: true },
  isSupportedByData: { type: Boolean, required: true },
  relatedIndicatorIds: { type: [String], default: [] },
  gapExplanation: { type: String, default: null },
});

const interpretationResultSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    privacySafeRepresentationId: { type: String, required: true, index: true },
    processingJobId: { type: String, required: true, index: true },
    versionNumber: { type: Number, required: true },
    previousInterpretationResultId: { type: String, default: null },
    datasetType: { type: String, required: true },
    overallConfidence: { type: Number, required: true },
    entities: { type: [interpretationEntitySchema], default: [] },
    indicators: { type: [interpretationIndicatorSchema], default: [] },
    relationships: { type: [interpretationRelationshipSchema], default: [] },
    questions: { type: [interpretationQuestionSchema], default: [] },
    warnings: { type: [interpretationWarningSchema], default: [] },
    goalAlignment: { type: [interpretationGoalCoverageSchema], default: [] },
  },
  {
    collection: "interpretation_results",
    timestamps: true,
  },
);

export type InterpretationResultMongoDocument = InferSchemaType<
  typeof interpretationResultSchema
>;
export type InterpretationResultMongoHydratedDocument =
  HydratedDocument<InterpretationResultMongoDocument>;
export const InterpretationResultMongoModel = createModel(
  "InterpretationResult",
  interpretationResultSchema,
);
