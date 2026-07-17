import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { analyticsScopeTypeValues } from "./analyticsContracts.js";
import {
  analyticsDashboardCompatibilitySourceValues,
  analyticsDashboardInteractionTypeValues,
} from "./analyticsDashboardEventPersistence.js";

const analyticsDashboardEventSchema = new Schema(
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
    userId: { type: String, required: true, index: true },
    resultId: { type: String, required: true, index: true },
    interactionType: {
      type: String,
      enum: [...analyticsDashboardInteractionTypeValues],
      required: true,
      index: true,
    },
    dashboardSchemaVersion: { type: String, required: true },
    dashboardCompatibilitySource: {
      type: String,
      enum: [...analyticsDashboardCompatibilitySourceValues],
      required: true,
    },
    orderedWidgetIds: { type: [String], default: [] },
    hiddenWidgetIds: { type: [String], default: [] },
    visibleWidgetIds: { type: [String], default: [] },
    widgetId: { type: String, default: null },
    occurredAt: { type: Date, required: true, index: true },
  },
  {
    collection: "analytics_dashboard_events",
    timestamps: true,
  },
);

export type AnalyticsDashboardEventMongoDocument = InferSchemaType<
  typeof analyticsDashboardEventSchema
>;
export type AnalyticsDashboardEventMongoHydratedDocument =
  HydratedDocument<AnalyticsDashboardEventMongoDocument>;
export const AnalyticsDashboardEventMongoModel = createModel(
  "AnalyticsDashboardEvent",
  analyticsDashboardEventSchema,
);
