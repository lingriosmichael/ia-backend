import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const organizationSettingsSchema = new Schema(
  {
    organizationName: { type: String, required: true, trim: true },
    legalForm: { type: String, default: null, trim: true },
    foundingYear: { type: Number, default: null },
    country: { type: String, default: null, trim: true },
    employeeCount: { type: Number, default: null },
    mission: { type: String, default: null, trim: true },
    activityAreas: { type: [String], default: [] },
    targetGroups: { type: [String], default: [] },
    operatingRegions: { type: [String], default: [] },
    isRecognizedNonProfit: { type: Boolean, default: null },
    taxExemptionValidFrom: { type: String, default: null },
  },
  {
    _id: false,
  },
);

const organizationSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    mission: { type: String, default: null },
    logoUrl: { type: String, default: null },
    settings: { type: organizationSettingsSchema, default: null },
  },
  {
    collection: "organizations",
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export type OrganizationMongoDocument = InferSchemaType<
  typeof organizationSchema
>;
export type OrganizationMongoHydratedDocument =
  HydratedDocument<OrganizationMongoDocument>;
export const OrganizationMongoModel = createModel(
  "Organization",
  organizationSchema,
);
