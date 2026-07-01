import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/create-model.js";

const projectSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    createdById: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    programGoal: { type: String, default: null },
    startMonth: { type: String, default: null },
    endMonth: { type: String, default: null },
    country: { type: String, default: null },
    regionCity: { type: String, default: null },
    sdgs: { type: [String], default: [] },
    targetBeneficiaries: { type: [String], default: [] },
    fundingSource: { type: String, default: null },
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

projectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

export type ProjectMongoDocument = InferSchemaType<typeof projectSchema>;
export type ProjectMongoHydratedDocument = HydratedDocument<ProjectMongoDocument>;
export const ProjectMongoModel = createModel("Project", projectSchema);
