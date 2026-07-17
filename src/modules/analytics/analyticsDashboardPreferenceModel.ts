import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { analyticsScopeTypeValues } from "./analyticsContracts.js";

const analyticsDashboardPreferenceSchema = new Schema(
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
    dashboardSchemaVersion: { type: String, required: true },
    orderedWidgetIds: { type: [String], default: [] },
    hiddenWidgetIds: { type: [String], default: [] },
    updatedById: { type: String, required: true },
  },
  {
    collection: "analytics_dashboard_preferences",
    timestamps: true,
  },
);

analyticsDashboardPreferenceSchema.index(
  { projectId: 1, activityId: 1, scopeType: 1 },
  { unique: true },
);

export type AnalyticsDashboardPreferenceMongoDocument = InferSchemaType<
  typeof analyticsDashboardPreferenceSchema
>;
export type AnalyticsDashboardPreferenceMongoHydratedDocument =
  HydratedDocument<AnalyticsDashboardPreferenceMongoDocument>;

export const AnalyticsDashboardPreferenceMongoModel = createModel(
  "AnalyticsDashboardPreference",
  analyticsDashboardPreferenceSchema,
);
