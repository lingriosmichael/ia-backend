import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";
import { analyticsScopeTypeValues } from "./analyticsContracts.js";

// `catalog`/`curation`/`dataQuality` are Mixed rather than nested Schemas:
// their shapes are unions/open-ended (see analyticsContracts.ts) and are
// already validated in TypeScript before a create() call ever reaches
// this model — mirroring the same choice made for
// InterpretationIndicator.suggestedCalculation/computedValue.
const analyticsResultSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    analyticsExecutionId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    activityId: { type: String, default: null, index: true },
    scopeType: {
      type: String,
      enum: [...analyticsScopeTypeValues],
      required: true,
    },
    catalogVersion: { type: String, required: true },
    knowledgeModelVersion: { type: Number, required: true },
    catalog: { type: Schema.Types.Mixed, required: true },
    curation: { type: Schema.Types.Mixed, required: true },
    dataQuality: { type: Schema.Types.Mixed, required: true },
    limitations: { type: [String], default: [] },
    generatedAt: { type: Date, required: true },
  },
  {
    collection: "analytics_results",
    timestamps: true,
  },
);

export type AnalyticsResultMongoDocument = InferSchemaType<
  typeof analyticsResultSchema
>;
export type AnalyticsResultMongoHydratedDocument =
  HydratedDocument<AnalyticsResultMongoDocument>;
export const AnalyticsResultMongoModel = createModel(
  "AnalyticsResult",
  analyticsResultSchema,
);
