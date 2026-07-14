import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import {
  analyticsExecutionStatusValues,
  analyticsScopeTypeValues,
} from "./analyticsContracts.js";

const analyticsExecutionSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    scopeType: {
      type: String,
      enum: [...analyticsScopeTypeValues],
      required: true,
    },
    status: {
      type: String,
      enum: [...analyticsExecutionStatusValues],
      required: true,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  {
    collection: "analytics_executions",
    timestamps: true,
  },
);

export type AnalyticsExecutionMongoDocument = InferSchemaType<
  typeof analyticsExecutionSchema
>;
export type AnalyticsExecutionMongoHydratedDocument =
  HydratedDocument<AnalyticsExecutionMongoDocument>;
export const AnalyticsExecutionMongoModel = createModel(
  "AnalyticsExecution",
  analyticsExecutionSchema,
);
