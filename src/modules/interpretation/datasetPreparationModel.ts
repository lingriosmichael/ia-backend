import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  datasetPreparationStatusValues,
  interpretationQuestionCodeValues,
} from "../../shared/contracts.js";

const datasetPreparationDecisionSchema = new Schema({
  questionId: { type: String, required: true },
  questionCode: {
    type: String,
    enum: [...interpretationQuestionCodeValues],
    required: true,
  },
  questionPrompt: { type: String, required: true },
  tableName: { type: String, default: null },
  columnName: { type: String, default: null },
  answeredValue: { type: String, required: true },
  answeredById: { type: String, default: null },
  answeredAt: { type: Date, default: null },
});

const datasetPreparationSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    privacySafeRepresentationId: { type: String, required: true, index: true },
    interpretationResultId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: [...datasetPreparationStatusValues],
      required: true,
    },
    blockingQuestionCount: { type: Number, required: true },
    answeredBlockingQuestionCount: { type: Number, required: true },
    unansweredBlockingQuestionIds: { type: [String], default: [] },
    decisions: { type: [datasetPreparationDecisionSchema], default: [] },
    decisionSummary: { type: Schema.Types.Mixed, required: true },
    preparedDataset: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: "dataset_preparations",
    timestamps: true,
  },
);

export type DatasetPreparationMongoDocument = InferSchemaType<
  typeof datasetPreparationSchema
>;
export type DatasetPreparationMongoHydratedDocument =
  HydratedDocument<DatasetPreparationMongoDocument>;
export const DatasetPreparationMongoModel = createModel(
  "DatasetPreparation",
  datasetPreparationSchema,
);
