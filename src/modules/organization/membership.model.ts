import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/create-model.js";

const membershipSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    role: {
      type: String,
      enum: ["ORGANIZATION_ADMIN", "PROJECT_MANAGER"],
      default: "PROJECT_MANAGER",
      required: true,
    },
  },
  {
    collection: "memberships",
    timestamps: true,
  },
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });

export type MembershipMongoDocument = InferSchemaType<typeof membershipSchema>;
export type MembershipMongoHydratedDocument =
  HydratedDocument<MembershipMongoDocument>;
export const MembershipMongoModel = createModel("Membership", membershipSchema);
