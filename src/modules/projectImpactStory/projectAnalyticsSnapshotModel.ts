import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const projectAnalyticsSnapshotSchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    sourceSnapshot: { type: [Schema.Types.Mixed], default: [] },
    activityCards: { type: [Schema.Types.Mixed], default: [] },
    headlineKpis: { type: [Schema.Types.Mixed], default: [] },
    chartPlan: { type: [Schema.Types.Mixed], default: [] },
    contextCharts: { type: [Schema.Types.Mixed], default: [] },
    diagnostics: { type: Schema.Types.Mixed, required: true },
    llmUsage: { type: Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
  },
  {
    collection: "project_analytics_snapshots",
    timestamps: true,
  },
);

projectAnalyticsSnapshotSchema.index({ projectId: 1, createdAt: -1 });

export type ProjectAnalyticsSnapshotMongoDocument = InferSchemaType<
  typeof projectAnalyticsSnapshotSchema
>;
export type ProjectAnalyticsSnapshotMongoHydratedDocument =
  HydratedDocument<ProjectAnalyticsSnapshotMongoDocument>;
export const ProjectAnalyticsSnapshotMongoModel = createModel(
  "ProjectAnalyticsSnapshot",
  projectAnalyticsSnapshotSchema,
);
