import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const activityAnalysisRunV2Schema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, required: true, index: true },
    activityName: { type: String, required: true },
    phase: { type: String, required: true },
    status: { type: String, required: true, index: true },
    goalsSnapshot: { type: Schema.Types.Mixed, required: true },
    evidence: { type: [Schema.Types.Mixed], default: [] },
    runLimits: { type: Schema.Types.Mixed, required: true },
    clarificationQuestions: { type: [Schema.Types.Mixed], default: [] },
    toolCallTrace: { type: [Schema.Types.Mixed], default: [] },
    calculations: { type: [Schema.Types.Mixed], default: [] },
    qualitativeFindings: { type: [Schema.Types.Mixed], default: [] },
    assessment: { type: Schema.Types.Mixed, default: null },
    diagnostics: { type: Schema.Types.Mixed, required: true },
    validation: { type: Schema.Types.Mixed, required: true },
    errorMessage: { type: String, default: null },
  },
  {
    collection: "activity_analysis_runs_v2",
    timestamps: true,
  },
);

export type ActivityAnalysisRunV2MongoDocument = InferSchemaType<
  typeof activityAnalysisRunV2Schema
>;
export type ActivityAnalysisRunV2MongoHydratedDocument =
  HydratedDocument<ActivityAnalysisRunV2MongoDocument>;
export const ActivityAnalysisRunV2MongoModel = createModel(
  "ActivityAnalysisRunV2",
  activityAnalysisRunV2Schema,
);
