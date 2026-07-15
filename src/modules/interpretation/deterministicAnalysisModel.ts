import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { deterministicAnalysisStatusValues } from "../../shared/contracts.js";

const deterministicAnalysisSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    uploadMetadataId: { type: String, required: true, index: true },
    privacySafeRepresentationId: { type: String, required: true, index: true },
    interpretationResultId: { type: String, required: true, unique: true, index: true },
    datasetPreparationId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: [...deterministicAnalysisStatusValues],
      required: true,
    },
    metrics: { type: [Schema.Types.Mixed], default: [] },
    distributions: { type: [Schema.Types.Mixed], default: [] },
    trends: { type: [Schema.Types.Mixed], default: [] },
    subgroupBreakdowns: { type: [Schema.Types.Mixed], default: [] },
    warnings: { type: [Schema.Types.Mixed], default: [] },
    candidateIndicators: { type: [Schema.Types.Mixed], default: [] },
  },
  {
    collection: "deterministic_analyses",
    timestamps: true,
  },
);

export type DeterministicAnalysisMongoDocument = InferSchemaType<
  typeof deterministicAnalysisSchema
>;
export type DeterministicAnalysisMongoHydratedDocument =
  HydratedDocument<DeterministicAnalysisMongoDocument>;
export const DeterministicAnalysisMongoModel = createModel(
  "DeterministicAnalysis",
  deterministicAnalysisSchema,
);
