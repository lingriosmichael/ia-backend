import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const projectSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    projectGoal: { type: String, default: null },
    startMonth: { type: String, default: null },
    endMonth: { type: String, default: null },
    fundingProgram: { type: String, default: null },
    fundingOrganization: { type: String, default: null },
    targetGroups: { type: [String], default: [] },
    areaOfOperation: { type: String, default: null },
    partnerships: { type: String, default: null },
    sdgs: { type: [String], default: [] },
    impactModel: {
      inputs: { type: String, default: null },
      activities: { type: String, default: null },
      outputs: { type: String, default: null },
      impact: { type: String, default: null },
      outcomes: { type: String, default: null },
    },
    successIndicators: { type: String, default: null },
    status: {
      type: String,
      enum: ["planning", "active", "completed"],
      default: "planning",
    },
  },
  {
    collection: "projects",
    timestamps: true,
  },
);

projectSchema.index({ organizationId: 1, ownerId: 1, createdAt: -1 });

export type ProjectMongoDocument = InferSchemaType<typeof projectSchema>;
export type ProjectMongoHydratedDocument =
  HydratedDocument<ProjectMongoDocument>;
export const ProjectMongoModel = createModel("Project", projectSchema);
