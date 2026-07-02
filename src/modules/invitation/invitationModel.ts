import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const invitationSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: { type: String, required: true, enum: ["PROJECT_MANAGER"] },
    token: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "accepted", "revoked"],
      default: "pending",
    },
    invitedById: { type: String, required: true },
    acceptedById: { type: String, default: null },
    acceptedAt: { type: Date, default: null },
  },
  {
    collection: "invitations",
    timestamps: true,
  },
);

invitationSchema.index(
  { organizationId: 1, email: 1, status: 1 },
  { partialFilterExpression: { status: "pending" } },
);

export type InvitationMongoDocument = InferSchemaType<typeof invitationSchema>;
export type InvitationMongoHydratedDocument = HydratedDocument<InvitationMongoDocument>;
export const InvitationMongoModel = createModel("Invitation", invitationSchema);
