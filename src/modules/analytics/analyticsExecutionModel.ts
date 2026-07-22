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
    language: {
      type: String,
      enum: ["de", "en"],
      required: true,
      default: "de",
    },
    status: {
      type: String,
      enum: [...analyticsExecutionStatusValues],
      required: true,
    },
    leaseOwner: { type: String, default: null, index: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    attemptCount: { type: Number, required: true, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: null, index: true },
    maxAttempts: { type: Number, required: true, default: 10, min: 1 },
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

analyticsExecutionSchema.index(
  {
    projectId: 1,
    activityId: 1,
    scopeType: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["QUEUED", "RUNNING"] },
    },
  },
);

analyticsExecutionSchema.index({
  status: 1,
  nextAttemptAt: 1,
  leaseExpiresAt: 1,
  createdAt: 1,
});

export type AnalyticsExecutionMongoDocument = InferSchemaType<
  typeof analyticsExecutionSchema
>;
export type AnalyticsExecutionMongoHydratedDocument =
  HydratedDocument<AnalyticsExecutionMongoDocument>;
export const AnalyticsExecutionMongoModel = createModel(
  "AnalyticsExecution",
  analyticsExecutionSchema,
);
