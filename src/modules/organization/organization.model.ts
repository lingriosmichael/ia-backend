import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/create-model.js";

const organizationSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    mission: { type: String, default: null },
    logoUrl: { type: String, default: null },
    // Legacy fields retained temporarily for migration compatibility.
    description: { type: String, default: null },
    logoPath: { type: String, default: null },
  },
  {
    collection: "organizations",
    timestamps: true,
  },
);

export type OrganizationMongoDocument = InferSchemaType<typeof organizationSchema>;
export type OrganizationMongoHydratedDocument =
  HydratedDocument<OrganizationMongoDocument>;
export const OrganizationMongoModel = createModel("Organization", organizationSchema);
