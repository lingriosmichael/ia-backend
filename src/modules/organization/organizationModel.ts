import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const organizationSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    mission: { type: String, default: null },
    logoUrl: { type: String, default: null },
  },
  {
    collection: "organizations",
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export type OrganizationMongoDocument = InferSchemaType<typeof organizationSchema>;
export type OrganizationMongoHydratedDocument =
  HydratedDocument<OrganizationMongoDocument>;
export const OrganizationMongoModel = createModel("Organization", organizationSchema);
