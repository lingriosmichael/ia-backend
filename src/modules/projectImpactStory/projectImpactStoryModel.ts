import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";
import { createDocumentId } from "../../shared/database/documentId.js";

const projectImpactStorySchema = new Schema(
  {
    _id: { type: String, default: createDocumentId },
    organizationId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    analyticsSnapshotId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    impactCatalog: { type: [Schema.Types.Mixed], default: [] },
    narrativeSummary: { type: String, default: null },
    narrativeStatus: { type: String, default: null },
    llmUsage: { type: Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
  },
  {
    collection: "project_impact_stories",
    timestamps: true,
  },
);

projectImpactStorySchema.index({ projectId: 1, createdAt: -1 });

export type ProjectImpactStoryMongoDocument = InferSchemaType<
  typeof projectImpactStorySchema
>;
export type ProjectImpactStoryMongoHydratedDocument =
  HydratedDocument<ProjectImpactStoryMongoDocument>;
export const ProjectImpactStoryMongoModel = createModel(
  "ProjectImpactStory",
  projectImpactStorySchema,
);
